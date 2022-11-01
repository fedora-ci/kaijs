/*
 * This file is part of kaijs

 * Copyright (c) 2022 Andrei Stepanov <astepano@redhat.com>
 * 
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 * 
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

/**
 * Messages from Brew hub
 */

import _ from 'lodash';
import debug from 'debug';
import Joi from 'joi';
import { Artifacts } from './db';
import {
  ArtifactModel,
  ArtifactTypes,
  PayloadBrewBuild,
  PayloadContainerImage,
  PayloadRedHatModule,
} from './db_interface';
import {
  THandler,
  customMerge,
  THandlersSet,
  NoNeedToProcessError,
} from './msg_handlers';
import { schemas } from './validation';
import { FileQueueMessage } from './fqueue';

const log = debug('kaijs:msg_handlers_brew');

const mkPayloadBuildTagBrewBuild = (body: any): PayloadBrewBuild => {
  const build_id = _.get(body, 'build.build_id');
  const build_id_str = _.isNumber(build_id) ? _.toString(build_id) : undefined;
  const payload: PayloadBrewBuild = {
    task_id: _.get(body, 'build.task_id'),
    /* Should be None for module */
    nvr: _.get(body, 'build.nvr'),
    issuer: _.get(body, 'build.owner_name'),
    /* same as body.build.name */
    component: _.get(body, 'build.package_name'),
    scratch: _.get(body, 'build.scratch', false),
    gate_tag_name: _.get(body, 'tag.name'),
    source: _.get(body, 'build.source'),
    build_id: build_id_str,
  };
  return payload;
};

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127801&contains=module_build_service_id
 */
const mkPayloadBuildTagRedHatModule = (body: any): PayloadRedHatModule => {
  const name: string = _.get(body, 'build.extra.typeinfo.module.name');
  const stream: string = _.get(body, 'build.extra.typeinfo.module.stream');
  const version: string = _.get(body, 'build.extra.typeinfo.module.version');
  const context: string = _.get(body, 'build.extra.typeinfo.module.context');
  const mbs_id = _.get(
    body,
    'build.extra.typeinfo.module.module_build_service_id',
  );
  const mbs_id_str = _.toString(mbs_id);
  const nsvc: string = _.join([name, stream, version, context], ':');
  const payload: PayloadRedHatModule = {
    name,
    version,
    stream,
    context,
    nsvc,
    mbs_id: mbs_id_str,
    nvr: _.get(body, 'build.nvr'),
    issuer: _.get(body, 'build.owner_name'),
    scratch: _.get(body, 'build.scratch', false),
    source: _.get(body, 'build.source'),
    gate_tag_name: _.get(body, 'tag.name'),
  };
  return payload;
};

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.complete&delta=127800&contains=container_build
 */
const mkPayloadBuildCompleteRedHatContainerImage = (
  body: any,
): PayloadContainerImage => {
  const payload: PayloadContainerImage = {
    task_id: _.get(body, 'info.extra.container_koji_task_id'),
    /* Should be None for module */
    nvr: _.get(body, 'info.nvr'),
    issuer: _.get(body, 'info.owner_name'),
    /* same as body.build.name */
    component: _.get(body, 'info.package_name'),
    /*
     * brew-builds cannot be scratch-builds.
     * Container scratch builds are just kojiTask and not kojiBuild. And kojiTask for container images miss lot of metadata
     */
    scratch: false,
    source: _.get(body, 'info.source'),
    build_id: _.get(body, 'info.build_id'),
    id: _.get(body, [
      'info',
      'extra',
      'image',
      'index',
      'digests',
      'application/vnd.docker.distribution.manifest.list.v2+json',
    ]),
    full_names: _.get(body, 'info.extra.image.index.pull', []),
    osbs_subtypes: _.get(body, 'info.extra.osbs_build.subtypes'),
  };
  return payload;
};

/**
 * At this moment message is already validated with: schema_brew_build_tag
 */
const handler_brew_tag = async (
  artifacts: Artifacts,
  fq_msg: FileQueueMessage,
): Promise<ArtifactModel> => {
  const { body } = fq_msg;
  /**
   * A RPM build or MBS build can be tagged to gate-tag
   */
  const isRedHatModule = _.has(
    body,
    'build.extra.typeinfo.module.module_build_service_id',
  );
  var artifactType: Extract<ArtifactTypes, 'redhat-module' | 'brew-build'>;
  var newPayload: PayloadBrewBuild | PayloadRedHatModule;
  var artifactID: string;
  const gateTagName = _.get(body, 'tag.name');
  if (isRedHatModule) {
    newPayload = mkPayloadBuildTagRedHatModule(body);
    artifactType = 'redhat-module';
    artifactID = _.toString(newPayload.mbs_id);
    const tag_parse_err = _.attempt(
      Joi.assert,
      gateTagName,
      schemas['gate_tag_redhat_module'],
    );
    if (_.isError(tag_parse_err)) {
      log(' [E] Cannot parse tag: %s%s', '\n', gateTagName);
      throw tag_parse_err;
    }
  } else {
    newPayload = mkPayloadBuildTagBrewBuild(body);
    artifactType = 'brew-build';
    artifactID = _.toString(newPayload.task_id);
    const tag_parse_err = _.attempt(
      Joi.assert,
      gateTagName,
      schemas['gate_tag_brew_build'],
    );
    if (_.isError(tag_parse_err)) {
      log(' [E] Cannot parse tag: %s%s', '\n', gateTagName);
      throw tag_parse_err;
    }
  }
  var artifact;
  try {
    artifact = await artifacts.findOrCreate(artifactType, artifactID);
  } catch (err) {
    log(
      ' [E] handler_brew_tag failed for artifact id: %s for %s',
      artifactID,
      artifactType,
    );
    throw err;
  }
  /**
   * Mutate artifact.rpm_build, assign any way, if artifact.rpm_build was undefined before
   */
  artifact.payload = _.mergeWith(artifact.payload, newPayload, customMerge);
  log(' [i] handler_brew_tag updated doc: %s%o', '\n', artifact);
  return artifact;
};

const setBrewBuildCompleteExpireTime = (dbArtifact: ArtifactModel) => {
  if (dbArtifact.type === 'redhat-container-image') {
    const expire_at = new Date();
    var keep_days = 182;
    expire_at.setDate(expire_at.getDate() + keep_days);
    dbArtifact.expire_at = expire_at;
  }
};

/**
 * At this moment message is already validated with: schema_brew_build_complete
 */
const handler_brew_build_complete = async (
  artifacts: Artifacts,
  fq_msg: FileQueueMessage,
): Promise<ArtifactModel> => {
  const { body } = fq_msg;
  const isRedHatContainerImage =
    _.get(body, 'info.extra.osbs_build.kind') === 'container_build';
  var artifactType: Extract<ArtifactTypes, 'redhat-container-image'>;
  const buildId = _.get(body, 'info.build_id');
  var newPayload: PayloadContainerImage;
  var artifactID: string;
  if (isRedHatContainerImage) {
    newPayload = mkPayloadBuildCompleteRedHatContainerImage(body);
    artifactType = 'redhat-container-image';
    artifactID = _.toString(newPayload.task_id);
  } else {
    const errMsg = `No VirtualTopic.eng.brew.build.complete handeler for build id: ${buildId}`;
    const brokerTopic = 'VirtualTopic.eng.brew.build.complete';
    throw new NoNeedToProcessError(errMsg, brokerTopic);
  }
  var artifact;
  try {
    artifact = await artifacts.findOrCreate(artifactType, artifactID);
  } catch (err) {
    log(
      ' [E] handler_brew_tag failed for artifact id: %s for %s',
      artifactID,
      artifactType,
    );
    throw err;
  }
  artifact.payload = _.mergeWith(artifact.payload, newPayload, customMerge);
  setBrewBuildCompleteExpireTime(artifact);
  log(' [i] handler_brew_build_complete updated doc: %s%o', '\n', artifact);
  return artifact;
};

/**
 * Declare set() from most specialized to most global regexes
 */
export const handlers: THandlersSet = new Map<RegExp, THandler>();

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127800&contains=gate
 */
handlers.set(/^VirtualTopic\.eng\.brew\.build\.tag$/, handler_brew_tag);

/*
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127800&contains=gate
 */
handlers.set(
  /^VirtualTopic\.eng\.brew\.build\.complete$/,
  handler_brew_build_complete,
);
