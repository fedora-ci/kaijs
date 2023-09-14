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
import {
  TGetSearchable,
  messageToString,
  TSearchableHandlersSet,
} from './msg_handlers';
import { FileQueueMessage } from '../fqueue';
import {
  Update,
  Document,
  getIndexName,
  SearchableRpm,
  ArtifactContext,
  SearchableEtaRpm,
} from './opensearch';
import {
  THandler,
  mkSearchable,
  THandlersSet,
  makeMessageData,
} from './msg_handlers';

const log = debug('kaijs:msg_handlers_eta');

const mkSearchableEta = (fq_msg: FileQueueMessage): SearchableEtaRpm => {
  const {
    body,
    broker_topic: brokerTopic,
    broker_msg_id: brokerMsgId,
  } = fq_msg;

  var searchable: SearchableEtaRpm = {
    nvr: _.get(body, 'nvr'),
    aType: 'brew-build',
    taskId: _.get(body, 'task_id'),
    issuer: _.get(body, 'owner'),
    component: _.get(body, 'package_name'),
    brokerMsgId,
    brokerTopic,
    etaCiRunUrl: _.get(body, 'ci_run_url'),
    etaCiRunOutcome: _.get(body, 'ci_run_outcome'),
    etaCiRunExplanation: _.get(body, 'ci_run_explanation'),
  };

  return searchable;
};

const mkSearchableEtaParent = (fq_msg: FileQueueMessage): SearchableRpm => {
  const { body } = fq_msg;
  var searchable: SearchableRpm = {
    nvr: _.get(body, 'nvr'),
    aType: 'brew-build',
    issuer: _.get(body, 'owner'),
    taskId: _.get(body, 'task_id'),
    component: _.get(body, 'package_name'),
  };
  return searchable;
};

const mkParentDocId = (fq_msg: FileQueueMessage): string => {
  const { body } = fq_msg;
  const type = 'brew-build';
  const id = body.task_id;
  return `${type}-${id}`;
};

const searchableEtaHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();
const searchableEtaParentHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();

searchableEtaHandlers.set(/^.*$/, mkSearchableEta);
searchableEtaParentHandlers.set(/^.*$/, mkSearchableEtaParent);

const handlerCommon = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Update[]> => {
  const { broker_msg_id, broker_extra, body } = fq_msg;
  const type = 'brew-build';
  /** ETA messages can have task_id == null, these messages will be dropped by validation */
  const docId = broker_msg_id;
  const artifactType = 'brew-build';
  const searchable = mkSearchable(
    fq_msg,
    searchableEtaHandlers,
  ) as SearchableEtaRpm;
  const searchableParent = mkSearchable(
    fq_msg,
    searchableEtaParentHandlers,
  ) as SearchableRpm;
  const msgFullText = messageToString(body) as string;
  const parentDocId = mkParentDocId(fq_msg);
  const indexName: string = getIndexName(artifactContext, artifactType);
  const messageData = makeMessageData(fq_msg);
  const doc: Document = {
    ...searchable,
    msgFullText,
    '@timestamp': broker_extra.timestamp,
    rawData: {
      message: messageData,
    },
    artToMsgs: {
      name: 'message',
      parent: parentDocId,
    },
  };
  const parentDoc: Document = {
    ...searchableParent,
    '@timestamp': broker_extra.timestamp,
    artToMsgs: {
      name: 'artifact',
    },
  };
  const routing = parentDocId;
  const upsert: Update = {
    doc,
    docId,
    routing,
    indexName,
    docAsUpsert: true,
  };
  const updateForParent: Update = {
    doc: {},
    docId: parentDocId,
    /* upsert() - jumps into action, only, and only if, there is no document */
    upsert: parentDoc,
    routing,
    indexName,
    docAsUpsert: false,
  };
  log(' [i] handlerCommon updated doc: %s%o', '\n', upsert);
  return [upsert];
};

const handlerBrewBuild: THandler = _.partial(handlerCommon, 'redhat');
export const handlers: THandlersSet = new Map<RegExp, THandler>();

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.osci.errata_automation.brew-build.run.finished&delta=127800
 */
handlers.set(
  /^VirtualTopic\.eng\.ci\.osci\.errata_automation\.brew-build\.run\.finished$/,
  handlerBrewBuild,
);
