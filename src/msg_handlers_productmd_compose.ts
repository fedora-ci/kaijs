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
 * modularity content do not have schema contend defined in
 * https://pagure.io/fedora-ci/messages/
 * https://issues.redhat.com/browse/OSCI-2280
 *
 * .nsvc: string
 * .stream: string;
 * .version: string;
 * .context: string;
 */

import _ from 'lodash';
import debug from 'debug';
import { Artifacts } from './db';
import {
  TPayload,
  ArtifactModel,
  ArtifactTypes,
  PayloadProductMDCompose,
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

const log = debug('kaijs:msg_handlers_productmd_compose');

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.yaml
 */
const mkPayloadV1 = (body: any): PayloadProductMDCompose => {
  const { artifact } = body;
  const pl = {
    id: _.get(artifact, 'id'),
    compose_type: _.get(artifact, 'nvr'),
    release_type: _.get(artifact, 'issuer'),
  };
  return pl;
};

const payloadHandlers: TPayloadHandlersSet = new Map<RegExp, TGetPayload>();
/**
 * Payload handlers are based on message version
 */
payloadHandlers.set(/^.*$/, mkPayloadV1);

const handlerCommon = async (
  _atype: ArtifactTypes,
  artifacts: Artifacts,
  fq_msg: FileQueueMessage
): Promise<ArtifactModel> => {
  const { broker_msg_id, body } = fq_msg;
  const { artifact } = body;
  const type = artifact.type;
  const mbs_id = artifact.id;
  var db_artifact;
  try {
    db_artifact = await artifacts.findOrCreate(type, _.toString(mbs_id));
  } catch (err) {
    log(' [E] handlerCommon failed for task_id: %s', mbs_id);
    throw err;
  }
  const build: TPayload = mkPayload(body, payloadHandlers);
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
      broker_msg_id
    );
    db_artifact.states.push(artifact_new_state);
    /**
     * Update 'current-state' and 'current-state-lengths'
     */
  } else {
    log(
      ' [i] handlerCommon already present state with msg_id: %s, msg_id: %s',
      thread_id,
      broker_msg_id
    );
  }
  db_artifact.payload = _.mergeWith(db_artifact.payload, build, customMerge);
  log(' [i] handlerCommon updated doc: %s%o', '\n', db_artifact);
  return db_artifact;
};

const handler: THandler = _.partial(handlerCommon, 'productmd-compose');

export const handlers: THandlersSet = new Map<RegExp, THandler>();

/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.productmd-compose.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.complete&delta=127800
 */
handlers.set(
  /^org.centos.prod.ci.productmd-compose.test.(complete|queued|running|error)$/,
  handler
);
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.productmd-compose\.test\.(complete|queued|running|error)$/,
  handler
);
/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.build.complete&delta=127800
 * https://dashboard.osci.redhat.com/#/artifact/productmd-compose/aid/Supp-9.0.0-RHEL-9-20201008.1
 */
