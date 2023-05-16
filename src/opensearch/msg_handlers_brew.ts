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
  Upsert,
  Document,
  getIndexName,
  SearchableRpm,
  SearchableRedHatModule,
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
    task_id: _.get(body, 'build.task_id'),
    /* Should be None for module */
    nvr: _.get(body, 'build.nvr'),
    issuer: _.get(body, 'build.owner_name'),
    /* same as body.build.name */
    component: _.get(body, 'build.package_name'),
    gate_tag_name: _.get(body, 'tag.name'),
    source: _.get(body, 'build.source'),
    build_id: buildIdStr,
    broker_msg_id_brew_tag: broker_msg_id,
  };
  return searchable;
};

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127801&contains=module_build_service_id
 */
const mkSearchableRedhatModuleFromBuildTagRedHatModule = (
  fq_msg: FileQueueMessage,
): SearchableRedHatModule => {
  const { body, broker_msg_id } = fq_msg;
  const name: string = _.get(body, 'build.extra.typeinfo.module.name');
  const stream: string = _.get(body, 'build.extra.typeinfo.module.stream');
  const version: string = _.get(body, 'build.extra.typeinfo.module.version');
  const context: string = _.get(body, 'build.extra.typeinfo.module.context');
  const mbsId = _.get(
    body,
    'build.extra.typeinfo.module.module_build_service_id',
  );
  const mbsIdStr = _.toString(mbsId);
  const nsvc: string = _.join([name, stream, version, context], ':');
  const searchable: SearchableRedHatModule = {
    name,
    version,
    stream,
    context,
    nsvc,
    mbs_id: mbsIdStr,
    nvr: _.get(body, 'build.nvr'),
    issuer: _.get(body, 'build.owner_name'),
    scratch: _.get(body, 'build.scratch', false),
    source: _.get(body, 'build.source'),
    gate_tag_name: _.get(body, 'tag.name'),
    broker_msg_id_brew_tag: broker_msg_id,
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
    broker_msg_id_build_complete: broker_msg_id,
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
): Promise<Upsert[]> => {
  const { body } = fq_msg;
  /**
   * A RPM build or MBS build can be tagged to gate-tag
   */
  const isRedHatModule = _.has(
    body,
    'build.extra.typeinfo.module.module_build_service_id',
  );
  let searchable: SearchableRpm | SearchableRedHatModule;
  const gateTagName = _.get(body, 'tag.name');
  let artifactType: ArtifactTypes;
  let artifactId;
  if (isRedHatModule) {
    searchable = mkSearchableRedhatModuleFromBuildTagRedHatModule(fq_msg);
    artifactType = 'redhat-module';
    artifactId = _.toString(searchable.mbs_id);
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
    artifactType = 'brew-build';
    artifactId = _.toString(searchable.task_id);
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
  const upsertDoc: Document = {
    searchable,
    '@timestamp': 0,
    artifact_message: {
      name: 'artifact',
    },
  };
  const routing = docId;
  const upsert: Upsert = {
    docId,
    indexName,
    upsertDoc,
    routing,
  };
  log(' [i] handlerCommon updated doc: %s%o', '\n', upsert);
  return [upsert];
};

/**
 * At this moment message is already validated with: schema_brew_build_complete
 */
const handler_brew_build_complete = async (
  fq_msg: FileQueueMessage,
): Promise<Upsert[]> => {
  const { body } = fq_msg;
  const isRedHatContainerImage =
    _.get(body, 'info.extra.osbs_build.kind') === 'container_build';
  const buildId = _.get(body, 'info.build_id');
  var searchable: SearchableContainerImage;
  let artifactType: ArtifactTypes;
  let artifactId: string;
  if (isRedHatContainerImage) {
    searchable = mkSearchableFromBuildCompleteRedHatContainerImage(fq_msg);
    artifactType = 'redhat-container-image';
    artifactId = _.toString(searchable.task_id);
  } else {
    const errMsg = `No VirtualTopic.eng.brew.build.complete handeler for build id: ${buildId}`;
    const brokerTopic = 'VirtualTopic.eng.brew.build.complete';
    throw new NoNeedToProcessError(errMsg, brokerTopic);
  }
  log(' [i] handler_brew_build_complete updated doc: %s%o', '\n', searchable);
  const docId = `${artifactType}-${artifactId}`;
  const indexName: string = getIndexName('fedora', artifactType);
  const upsertDoc: Document = {
    searchable,
    '@timestamp': 0,
    artifact_message: {
      name: 'artifact',
    },
  };
  const routing = docId;
  const upsert: Upsert = {
    docId,
    indexName,
    upsertDoc,
    routing,
  };
  log(' [i] handlerCommon updated doc: %s%o', '\n', upsert);
  return [upsert];
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
