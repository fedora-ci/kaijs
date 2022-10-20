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
 * Create a db-entry with schema: schema_db_artifact
 * Extract only required fields.
 * Store unmodified message at 'db_artifact.states[]'.
 * msg - passed schema_rpm_build_test_complete schema
 *
 * Example:
 *
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.cvp.redhat-container-image.test.complete&delta=86400
 *
 * Topics:
 *
 * * VirtualTopic.eng.ci.redhat-container-image.test.complete
 * * VirtualTopic.eng.ci.*.redhat-container-image.test.complete
 *
 */

import _ from 'lodash';
import debug from 'debug';
import { Artifacts } from './db';
import {
  TPayload,
  ArtifactModel,
  ArtifactTypes,
  PayloadContainerImage,
} from './db_interface';
import {
  THandler,
  mkPayload,
  makeState,
  customMerge,
  TGetPayload,
  THandlersSet,
  TPayloadHandlersSet,
} from './msg_handlers';
import { FileQueueMessage } from './fqueue';
import { assert_is_valid } from './validation';

const log = debug('kaijs:msg_handlers_container_image');

const mkPayloadV1 = (body: any): PayloadContainerImage => {
  const { artifact } = body;
  const pl = {
    task_id: _.get(artifact, 'task_id'),
    nvr: _.get(artifact, 'nvr'),
    source: _.get(artifact, 'source'),
    issuer: _.get(artifact, 'issuer'),
    scratch: _.get(artifact, 'scratch'),
    component: _.get(artifact, 'component'),
    build_id: _.get(artifact, 'build_id'),
    /* A digest that uniquely identifies the image within a repository. */
    id: _.get(artifact, 'id'),
    name: _.get(artifact, 'name'),
    namespace: _.get(artifact, 'namespace'),
    full_names: _.get(artifact, 'full_names'),
    registry_url: _.get(artifact, 'registry_url'),
    tag: _.get(artifact, 'tag'),
  };
  return pl;
};

const setExpire = (dbArtifact: ArtifactModel) => {
  const scratch = _.get(dbArtifact.payload, 'scratch');
  if (_.isBoolean(scratch) && scratch) {
    const expire_at = new Date();
    var keep_days = 60;
    expire_at.setDate(expire_at.getDate() + keep_days);
    dbArtifact.expire_at = expire_at;
  }
};

const payloadHandlers: TPayloadHandlersSet = new Map<RegExp, TGetPayload>();
/**
 * Payload handlers are based on message version
 */
payloadHandlers.set(/^.*$/, mkPayloadV1);

const handlerCommon = async (
  _atype: ArtifactTypes,
  artifacts: Artifacts,
  fq_msg: FileQueueMessage,
): Promise<ArtifactModel> => {
  const { broker_msg_id, body } = fq_msg;
  const { artifact } = body;
  assert_is_valid(artifact, 'valid_artifact_issuer');
  const type = artifact.type;
  const task_id = artifact.task_id;
  var db_artifact;
  try {
    db_artifact = await artifacts.findOrCreate(type, _.toString(task_id));
  } catch (err) {
    log(' [E] handlerCommon failed for task_id: %s', task_id);
    throw err;
  }
  const newPayload: TPayload = mkPayload(body, payloadHandlers);
  /**
   * Store broker-message to new state
   */
  const artifact_new_state = makeState(fq_msg);
  const thread_id = artifact_new_state.kai_state.thread_id;
  db_artifact.states = _.defaultTo(db_artifact.states, []);
  if (
    !_.includes(_.map(db_artifact.states, 'kai_state.msg_id'), broker_msg_id)
  ) {
    log(
      ' [i] handlerCommon adding new state with thread_id: %s, msg_id: %s',
      thread_id,
      broker_msg_id,
    );
    db_artifact.states.push(artifact_new_state);
  } else {
    log(
      ' [i] handlerCommon already present state with msg_id: %s, msg_id: %s',
      thread_id,
      broker_msg_id,
    );
  }
  db_artifact.payload = _.mergeWith(
    db_artifact.payload,
    newPayload,
    customMerge,
  );
  setExpire(db_artifact);
  return db_artifact;
};

const handlerRedhatContainerImage: THandler = _.partial(
  handlerCommon,
  'redhat-container-image',
);

export const handlers: THandlersSet = new Map<RegExp, THandler>();

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.cvp.redhat-container-image.test.complete&delta=86400
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-container-image.test.complete.yaml
 */
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.redhat-container-image\.test\.(complete|queued|running|error)$/,
  handlerRedhatContainerImage,
);
