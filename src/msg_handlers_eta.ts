/*
 * This file is part of kaijs
 *
 * Copyright (c) 2023 Andrei Stepanov <astepano@redhat.com>
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
 * TODO
 *
 * Update this code to support MBS builds and side-tag batches when https://issues.redhat.com/browse/OSCI-2310
 * is ready.
 */

import _ from 'lodash';
import debug from 'debug';
import { Artifacts } from './db';
import {
  ArtifactModel,
  ArtifactTypes,
  ErrataToolAutomationState,
} from './db_interface';
import { THandler, THandlersSet, makeEtaState } from './msg_handlers';
import { FileQueueMessage } from './fqueue';

const log = debug('kaijs:msg_handlers_eta');

const handlerCommon = async (
  _atype: ArtifactTypes,
  artifacts: Artifacts,
  fq_msg: FileQueueMessage,
): Promise<ArtifactModel> => {
  const { broker_msg_id, body } = fq_msg;
  const type = 'brew-build';
  /** ETA messages can have task_id == null, these messages will be dropped by validation */
  const task_id = body.task_id;
  var db_artifact;
  try {
    db_artifact = await artifacts.findOrCreate(type, _.toString(task_id));
  } catch (err) {
    log(' [E] handlerCommon failed for task_id: %s', task_id);
    throw err;
  }
  /**
   * Store broker-message to new ETA state
   */
  const new_state: ErrataToolAutomationState = makeEtaState(fq_msg);
  db_artifact.states_eta = _.defaultTo(db_artifact.states_eta, []);
  if (
    !_.includes(
      _.map(db_artifact.states_eta, 'kai_state.msg_id'),
      broker_msg_id,
    )
  ) {
    log(
      ' [i] handlerCommon adding new ETA state with msg_id: %s',
      broker_msg_id,
    );
    db_artifact.states_eta.push(new_state);
  } else {
    log(
      ' [i] handlerCommon already present state with msg_id: %s',
      broker_msg_id,
    );
  }
  return db_artifact;
};

const handlerBrewBuild: THandler = _.partial(handlerCommon, 'brew-build');

export const handlers: THandlersSet = new Map<RegExp, THandler>();

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.osci.errata_automation.brew-build.run.finished&delta=127800
 */
handlers.set(
  /^VirtualTopic\.eng\.ci\.osci\.errata_automation\.brew-build\.run\.finished$/,
  handlerBrewBuild,
);
