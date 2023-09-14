/*
 * This file is part of kaijs

 * Copyright (c) 2022, 2023 Andrei Stepanov <astepano@redhat.com>
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
import Joi from 'joi';
import debug from 'debug';
import { THandler, THandlersSet, NoNeedToProcessError } from './msg_handlers';
import { schemas } from '../validation';
import { FileQueueMessage } from '../fqueue';
import {
  Update,
  Document,
  getIndexName,
  SearchableRpm,
  SearchableMbs,
  SearchableContainerImage,
} from './opensearch';
import { ArtifactTypes } from '../db_interface';

const log = debug('kaijs:msg_handlers_brew');

const mkSearchableRPMFromBuildTagBrewBuild = (
  fq_msg: FileQueueMessage,
): SearchableRpm => {
  const { body, broker_msg_id } = fq_msg;
  const buildId = _.get(body, 'build.build_id');
  const buildIdStr = _.toString(buildId);
  const searchable: SearchableRpm = {
    nvr: _.get(body, 'build.nvr'),
    aType: 'brew-build',
    issuer: _.get(body, 'build.owner_name'),
    source: _.get(body, 'build.source'),
    taskId: _.get(body, 'build.task_id'),
    buildId: buildIdStr,
    gateTag: _.get(body, 'tag.name'),
    /* same as body.build.name */
    component: _.get(body, 'build.package_name'),
    brokerMsgIdGateTag: broker_msg_id,
  };
  return searchable;
};

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127801&contains=module_build_service_id
 */
const mkSearchableRedhatModuleFromBuildTagRedHatModule = (
  fq_msg: FileQueueMessage,
): SearchableMbs => {
  const { body, broker_msg_id } = fq_msg;
  const modName: string = _.get(body, 'build.extra.typeinfo.module.name');
  const modStream: string = _.get(body, 'build.extra.typeinfo.module.stream');
  const modVersion: string = _.get(body, 'build.extra.typeinfo.module.version');
  const modContext: string = _.get(body, 'build.extra.typeinfo.module.context');
  const mbsId = _.get(
    body,
    'build.extra.typeinfo.module.module_build_service_id',
  );
  const mbsIdStr = _.toString(mbsId);
  const nsvc: string = _.join(
    [modName, modStream, modVersion, modContext],
    ':',
  );
  const searchable: SearchableMbs = {
    nsvc,
    aType: 'redhat-module',
    mbsId: mbsIdStr,
    modName,
    modStream,
    modVersion,
    modContext,
    nvr: _.get(body, 'build.nvr'),
    issuer: _.get(body, 'build.owner_name'),
    scratch: _.get(body, 'build.scratch', false),
    source: _.get(body, 'build.source'),
    gateTag: _.get(body, 'tag.name'),
    brokerMsgIdGateTag: broker_msg_id,
  };
  return searchable;
};

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.complete&delta=127800&contains=container_build
 */
const mkSearchableFromBuildCompleteRedHatContainerImage = (
  fq_msg: FileQueueMessage,
): SearchableContainerImage => {
  const { broker_msg_id, body } = fq_msg;
  const payload: SearchableContainerImage = {
    aType: 'redhat-container-image',
    taskId: _.get(body, 'info.extra.container_koji_task_id'),
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
    buildId: _.get(body, 'info.build_id'),
    contId: _.get(body, [
      'info',
      'extra',
      'image',
      'index',
      'digests',
      'application/vnd.docker.distribution.manifest.list.v2+json',
    ]),
    contFullNames: _.get(body, 'info.extra.image.index.pull', []),
    osbsSubtypes: _.get(body, 'info.extra.osbs_build.subtypes'),
    brokerMsgIdBuildComplete: broker_msg_id,
  };
  return payload;
};

/**
 * At this moment message is already validated with: schema_brew_build_tag
 *
 * Brew tag can tag:
 *
 * * RPM (not scratch -> has buildId and taskId)
 * * Module
 */
const handler_brew_tag = async (
  fq_msg: FileQueueMessage,
): Promise<Update[]> => {
  const { body, broker_extra } = fq_msg;
  /**
   * A RPM build or MBS build can be tagged to gate-tag
   */
  const isRedHatModule = _.has(
    body,
    'build.extra.typeinfo.module.module_build_service_id',
  );
  let searchable: SearchableRpm | SearchableMbs;
  const gateTagName = _.get(body, 'tag.name');
  let artifactType: ArtifactTypes;
  let artifactId;
  if (isRedHatModule) {
    searchable = mkSearchableRedhatModuleFromBuildTagRedHatModule(fq_msg);
    artifactType = searchable.aType;
    artifactId = _.toString(searchable.mbsId);
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
    searchable = mkSearchableRPMFromBuildTagBrewBuild(fq_msg);
    artifactType = searchable.aType;
    artifactId = _.toString(searchable.taskId);
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
  const docId = `${artifactType}-${artifactId}`;
  const indexName: string = getIndexName('redhat', artifactType);
  const doc: Document = {
    ...searchable,
    '@timestamp': broker_extra.timestamp,
    artToMsgs: {
      name: 'artifact',
    },
  };
  const routing = docId;
  const update: Update = {
    doc,
    docId,
    routing,
    indexName,
    docAsUpsert: true,
  };
  log(' [i] handlerCommon updated doc: %s%o', '\n', update);
  return [update];
};

/**
 * At this moment message is already validated with: schema_brew_build_complete
 */
const handler_brew_build_complete = async (
  fq_msg: FileQueueMessage,
): Promise<Update[]> => {
  const { body, broker_extra } = fq_msg;
  const isRedHatContainerImage =
    _.get(body, 'info.extra.osbs_build.kind') === 'container_build';
  const buildId = _.get(body, 'info.build_id');
  var searchable: SearchableContainerImage;
  let artifactType: ArtifactTypes;
  let artifactId: string;
  if (isRedHatContainerImage) {
    searchable = mkSearchableFromBuildCompleteRedHatContainerImage(fq_msg);
    artifactType = searchable.aType;
    artifactId = _.toString(searchable.taskId);
  } else {
    const errMsg = `No VirtualTopic.eng.brew.build.complete handeler for build id: ${buildId}`;
    const brokerTopic = 'VirtualTopic.eng.brew.build.complete';
    throw new NoNeedToProcessError(errMsg, brokerTopic);
  }
  log(' [i] handler_brew_build_complete updated doc: %s%o', '\n', searchable);
  const docId = `${artifactType}-${artifactId}`;
  const indexName: string = getIndexName('redhat', artifactType);
  const doc: Document = {
    ...searchable,
    '@timestamp': broker_extra.timestamp,
    artToMsgs: {
      name: 'artifact',
    },
  };
  const routing = docId;
  const update: Update = {
    doc,
    docId,
    routing,
    indexName,
    docAsUpsert: true,
  };
  log(' [i] handlerCommon updated doc: %s%o', '\n', update);
  return [update];
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
