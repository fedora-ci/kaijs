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
  Upsert,
  Document,
  getIndexName,
  ArtifactTypes,
  SearchableRpm,
  ArtifactContext,
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
  fq_msg: FileQueueMessage,
  buildInfo: any,
): SearchableRpm => {
  const { body, broker_msg_id } = fq_msg;
  const buildId = _.get(body, 'build_id');
  const taskId = _.toString(buildInfo.task_id);
  const gateTagName = _.get(body, 'tag');
  const searchable: SearchableRpm = {
    task_id: taskId,
    build_id: _.toString(buildId),
    nvr: _.get(buildInfo, 'nvr'),
    issuer: body.owner,
    source: _.get(buildInfo, 'extra.source.original_url'),
    component: _.get(buildInfo, 'name'),
    gate_tag_name: gateTagName,
    broker_msg_id_brew_tag: broker_msg_id,
  };

  return searchable;
};

const handler_buildsys_tag = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Upsert[]> => {
  const hubName = ContextToKojiInstance[artifactContext];
  assert.ok(
    hubName,
    `Cannot get hub name for artifact context: ${artifactContext}`,
  );
  const { body } = fq_msg;
  const { build_id } = body;
  let buildInfo;
  try {
    buildInfo = await koji_query(hubName, 'getBuild', build_id);
  } catch (err) {
    log(
      ' [E] handler_buildsys_tag cannot get buildInfo for build_id: %s',
      body.build_id,
    );
    throw err;
  }
  assert_is_valid(buildInfo, 'koji_build_info');
  let searchable: SearchableRpm;
  let artifactType: ArtifactTypes;
  let artifactId;
  searchable = mkSearchableRPMFromBuildTagKojiBuild(fq_msg, buildInfo);
  if (artifactContext === 'fedora') {
    artifactType = 'koji-build';
  } else if (artifactContext === 'centos') {
    artifactType = 'koji-build-cs';
  }
  artifactType = 'koji-build';
  artifactId = _.toString(searchable.task_id);
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
