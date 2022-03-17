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
import assert from 'assert';
import Joi from 'joi';
import { Artifacts } from './db';
import {
  ArtifactModel,
  ArtifactTypes,
  atype_to_hub_map,
  PayloadBrewBuild,
  PayloadRedHatModule,
} from './db_interface';
import { THandler, customMerge, THandlersSet, mkPayload } from './msg_handlers';
import { assert_is_valid, schemas } from './validation';
import { FileQueueMessage } from './fqueue';

const log = debug('kaijs:msg_handlers_brew');

const mkPayloadBrewBuild = (body: any): PayloadBrewBuild => {
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
    build_id: _.get(body, 'build.build_id'),
  };
  return payload;
};

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127801&contains=module_build_service_id
 */
const mkPayloadRedHatModule = (body: any): PayloadRedHatModule => {
  const name: string = _.get(body, 'build.extra.typeinfo.module.name');
  const stream: string = _.get(body, 'build.extra.typeinfo.module.stream');
  const version: string = _.get(body, 'build.extra.typeinfo.module.version');
  const context: string = _.get(body, 'build.extra.typeinfo.module.context');
  const nsvc: string = _.join([name, stream, version, context], ':');
  const payload: PayloadRedHatModule = {
    name,
    version,
    stream,
    context,
    nsvc,
    mbs_id: _.get(body, 'build.extra.typeinfo.module.module_build_service_id'),
    nvr: _.get(body, 'build.nvr'),
    issuer: _.get(body, 'build.owner_name'),
    scratch: _.get(body, 'build.scratch', false),
    source: _.get(body, 'build.source'),
    gate_tag_name: _.get(body, 'tag.name'),
  };
  return payload;
};

/**
 * At this moment message is already validated with: schema_brew_build_tag
 */
const handler_brew_tag = async (
  artifacts: Artifacts,
  fq_msg: FileQueueMessage
): Promise<ArtifactModel> => {
  const { body } = fq_msg;
  /**
   * A RPM build or MBS build can be tagged to gate-tag
   */
  const isRedHatModule = _.has(
    body,
    'body.build.extra.typeinfo.module.module_build_service_id'
  );
  var artifactType: Extract<ArtifactTypes, 'redhat-module' | 'brew-build'>;
  var newPayload: PayloadBrewBuild | PayloadRedHatModule;
  var artifactID: string;
  const gateTagName = _.get(body, 'tag.name');
  if (isRedHatModule) {
    newPayload = mkPayloadRedHatModule(body);
    artifactType = 'redhat-module';
    artifactID = _.toString(newPayload.mbs_id);
    const tag_parse_err = _.attempt(
      Joi.assert,
      fq_msg,
      schemas['gate_tag_redhat_module']
    );
    if (_.isError(tag_parse_err)) {
      log(' [E] Cannot parse tag: %s%s', '\n', gateTagName);
      throw tag_parse_err;
    }
  } else {
    newPayload = mkPayloadBrewBuild(body);
    artifactType = 'brew-build';
    artifactID = _.toString(newPayload.task_id);
    const tag_parse_err = _.attempt(
      Joi.assert,
      fq_msg,
      schemas['gate_tag_brew_build']
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
      artifactType
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

/**
 * Declare set() from most specialized to most global regexes
 */
export const handlers: THandlersSet = new Map<RegExp, THandler>();

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127800&contains=gate
 */
handlers.set(/^VirtualTopic\.eng\.brew\.build\.tag$/, handler_brew_tag);
