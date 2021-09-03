/*
 * This file is part of kaijs

 * Copyright (c) 2021 Andrei Stepanov <astepano@redhat.com>
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

import _ from 'lodash';
import Joi from 'joi';
import debug from 'debug';
import { metrics_up_parse } from './metrics';
import { schemas_broker } from './validation_broker';

const log = debug('kaijs:validation');

/**
 * Schemas define only required set.
 * Schemas do not define all possible fields.
 */
const schema_fq_msg = Joi.object({
  /** File-queue message id */
  fq_msg_id: Joi.string().required(),
  /** Msg ID, known in UMB/RabbitMQ broker */
  broker_msg_id: Joi.string().required(),
  /** UMB/RabbitMQ topic */
  broker_topic: Joi.string().required(),
  /** Any string, for example: "virtualdb" or "kai-listener-umb" */
  provider_name: Joi.string().required(),
  /** When provider received message */
  provider_timestamp: Joi.date().timestamp(),
  /** Timestamp from message header */
  header_timestamp: Joi.date().timestamp(),
  /** Payload of message */
  body: Joi.object().required(),
});

/**
 * VirtualTopic.eng.brew.build.tag
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127800
 *
 */
export const schema_broker_brew_build_tag = Joi.object({});

const schema_koji_build_info = Joi.object({
  /** 1740300 */
  build_id: Joi.number().integer().greater(0).required(),
  /** 1740300 */
  id: Joi.number().integer().greater(0).required(),
  /** 3 or null */
  epoch: Joi.number().integer().allow(null).required(),
  /** 'fedora-toolbox' */
  name: Joi.string().required(),
  /** 'fedora-toolbox-35-4' */
  nvr: Joi.string().required(),
  /** 56 */
  owner_id: Joi.number().integer().greater(0).required(),
  /** petersen */
  owner_name: Joi.string().required(),
  /** 27605 */
  package_id: Joi.number().integer().greater(0).required(),
  /** 'fedora-toolbox' */
  package_name: Joi.string().required(),
  /** '4' */
  release: Joi.string().required(),
  /** 'https://src.fedoraproject.org/container/fedora-toolbox.git#8ad99234bdc0d0972273057a610b2e10c96508f7' */
  source: Joi.string().required(),
  /** 1 */
  state: Joi.number().integer().greater(0).required(),
  /** 111111 */
  task_id: Joi.number().integer().greater(0).required(),
  /** '35' */
  version: Joi.string().required(),
  /** '2021-04-26 02:47:59+00:00' */
  start_time: Joi.string().required(),
  /** 1616803817.206323 */
  start_ts: Joi.number().greater(0).required(),
  /** '2021-04-26 02:51:01+00:00' */
  completion_time: Joi.string().required(),
  /** 1616803817.206323 */
  completion_ts: Joi.number().greater(0).required(),
  /** 72241627 */
  creation_event_id: Joi.number().integer().greater(0).required(),
  /** '2021-04-26 02:51:10.076183+00:00' */
  creation_time: Joi.string().required(),
  /** 1619405470.076183 */
  creation_ts: Joi.number().greater(0).required(),
  /** 0 */
  volume_id: Joi.number().integer().required(),
  /** 'DEFAULT' */
  volume_name: Joi.string().required(),
  /** 1 */
  cg_id: Joi.number().integer().greater(0).allow(null).required(),
  /** 'atomic-reactor' */
  cg_name: Joi.string().allow(null).required(),
});

/**
 * KaiState
 * Schema for KaiState in dbInterface.ts
 */
const schema_kai_state = Joi.object({
  thread_id: Joi.string().required(),
  msg_id: Joi.string().required(),
  version: Joi.string().required(),
  stage: Joi.string()
    .valid('build', 'test', 'dispatch', 'promote', 'gate')
    .required(),
  state: Joi.string()
    .valid('queued', 'running', 'complete', 'error')
    .required(),
  timestamp: Joi.number().greater(0).required(),
  origin: Joi.object({
    creator: Joi.string().required(),
    reason: Joi.string().required(),
  }),
  /**
   * requre at least 2 dots, no whitespaces
   */
  test_case_name: Joi.string().pattern(/^\S+\.\S+\.\S+$/),
});

/**
 */
const schema_db_artifact_state = Joi.object({
  kai_state: schema_kai_state,
});

/**
 * DB artifact model, should stay in sync with:
 * dbInterfacts -> ArtifactModel
 */
const schema_db_artifact = Joi.object({
  _version: Joi.number().integer().greater(0).required(),
  _updated: Joi.date().iso(),
  aid: Joi.string().required(),
  type: Joi.string().required(),
  rpm_build: Joi.object({
    nvr: Joi.string(),
    issuer: Joi.string().required(),
    component: Joi.string().required(),
    scratch: Joi.boolean().required(),
    gate_tag_name: Joi.string(),
    /** source is not required entry in messages */
    source: Joi.string(),
    task_id: Joi.number().integer().greater(0).required(),
    build_id: Joi.number().integer().greater(0),
  }),
  mbs_build: Joi.object({
    name: Joi.string().required(),
    stream: Joi.string().required(),
    version: Joi.string().required(),
    context: Joi.string().required(),
    nsvc: Joi.string().required(),
  }),
  dist_git_pr: Joi.object({
    uid: Joi.string().required(),
    repository: Joi.string().required(),
    comment_id: Joi.string().required(),
    commit_hash: Joi.string().required(),
    issuer: Joi.string().required(),
  }),
  productmd_compose: Joi.object({
    compose_type: Joi.string().required(),
  }),
  current_state_lenghts: Joi.object({
    queued: Joi.number().integer(),
    running: Joi.number().integer(),
    complete: Joi.number().integer(),
    error: Joi.number().integer(),
  }),
  resultsdb_testcase: Joi.array().items(Joi.string()),
  states: Joi.array().items(schema_db_artifact_state),
  current_state: {
    queued: Joi.array().items(schema_db_artifact_state),
    running: Joi.array().items(schema_db_artifact_state),
    complete: Joi.array().items(schema_db_artifact_state),
    error: Joi.array().items(schema_db_artifact_state),
  },
  /**
   * if only one of rpm_build, mbs_build, or dist_git_pr is allowed, but none are required
   */
}).oxor('rpm_build', 'mbs_build', 'dist_git_pr', 'productmd_compose');

const schemas_fq = {
  fq_msg: schema_fq_msg,
};

const schemas_db = {
  db_artifact: schema_db_artifact,
  kai_state: schema_kai_state,
};

const schemas_koji = {
  koji_build_info: schema_koji_build_info,
};

export const schemas = _.merge(
  schemas_fq,
  schemas_db,
  schemas_koji,
  schemas_broker
);

export type SchemaName = keyof typeof schemas;

export function assert_is_valid(obj: any, schema_name: SchemaName) {
  const parse_err = _.attempt(Joi.assert, obj, schemas[schema_name], {
    allowUnknown: true,
  });
  if (_.isError(parse_err)) {
    log(
      " [E] object doesn't comply with schema: %s%s%o",
      schema_name,
      '\n',
      obj
    );
    metrics_up_parse(schema_name, 'err');
    throw parse_err;
  }
  metrics_up_parse(schema_name, 'ok');
}
