/*
 * This file is part of kaijs

 * Copyright (c) 2021, 2022, 2023 Andrei Stepanov <astepano@redhat.com>
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
 * Messages from Koji hub
 */

import _ from 'lodash';
import debug from 'debug';
import assert from 'assert';
import { koji_query, KojiHubName } from '../koji';
import { THandler, THandlersSet } from './msg_handlers';
import { assert_is_valid } from '../validation';
import { FileQueueMessage } from '../fqueue';
import {
  Update,
  Document,
  getIndexName,
  ArtifactTypes,
  SearchableRpm,
  ArtifactContext,
  getFqMsgTimestamp,
} from './opensearch';

const log = debug('kaijs:msg_handlers_koji');

const ContextToKojiInstance: { [key in ArtifactContext]?: KojiHubName } = {
  fedora: 'fedora',
  centos: 'centos',
};

/**
 * "msg": {
 *  "build_id": 1728223,
 *  "name": "gcompris-qt",
 *  "instance": "primary",
 *  "tag": "f33-updates",
 *  "user": "bodhi",
 *  "version": "1.1",
 *  "owner": "musuruan",
 *  "release": "1.fc33"
 * }
 */
const mkSearchableRPMFromBuildTagKojiBuild = (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
  buildInfo: any,
): SearchableRpm => {
  const { body, broker_msg_id: brokerMsgIdGateTag } = fq_msg;
  const buildId = _.get(body, 'build_id');
  const taskId = _.toString(buildInfo.task_id);
  const gateTag = _.get(body, 'tag');
  let aType: ArtifactTypes;
  if (artifactContext === 'fedora') {
    aType = 'koji-build';
  } else if (artifactContext === 'centos') {
    aType = 'koji-build-cs';
  } else {
    throw new Error(`Unknonwn context ${artifactContext}`);
  }
  const searchable: SearchableRpm = {
    nvr: _.get(buildInfo, 'nvr'),
    aType,
    issuer: body.owner,
    source: _.get(buildInfo, 'extra.source.original_url'),
    scratch: false,
    taskId,
    gateTag,
    buildId: _.toString(buildId),
    component: _.get(buildInfo, 'name'),
    brokerMsgIdGateTag,
  };

  return searchable;
};

const handler_buildsys_tag = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Update[]> => {
  const hubName = ContextToKojiInstance[artifactContext];
  assert.ok(
    hubName,
    `Cannot get hub name for artifact context: ${artifactContext}`,
  );
  const { body, broker_extra } = fq_msg;
  const { buildId } = body;
  let buildInfo;
  try {
    buildInfo = await koji_query(hubName, 'getBuild', buildId);
  } catch (err) {
    log(
      ' [E] handler_buildsys_tag cannot get buildInfo for build_id: %s',
      body.build_id,
    );
    throw err;
  }
  assert_is_valid(buildInfo, 'koji_build_info');
  const searchable: SearchableRpm = mkSearchableRPMFromBuildTagKojiBuild(
    artifactContext,
    fq_msg,
    buildInfo,
  );
  const aType: ArtifactTypes = searchable.aType;
  const aId = _.toString(searchable.taskId);
  const docId = `${aType}-${aId}`;
  const indexName: string = getIndexName(artifactContext, aType);
  const doc: Document = {
    ...searchable,
    '@timestamp': getFqMsgTimestamp(fq_msg),
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
/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.buildsys.tag&delta=12780
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.fedoraproject.prod.buildsys.tag&delta=127800
 */
export const handlers: THandlersSet = new Map<RegExp, THandler>();

handlers.set(
  /^org.centos.prod.buildsys.tag$/,
  _.partial(handler_buildsys_tag, 'centos'),
);

handlers.set(
  /^org.fedoraproject.prod.buildsys.tag$/,
  _.partial(handler_buildsys_tag, 'fedora'),
);
