/*
 * This file is part of kaijs

 * Copyright (c) 2021, 2022 Andrei Stepanov <astepano@redhat.com>
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
import { koji_query, KojiHubName } from './koji';
import { Artifacts } from './db';
import {
  ArtifactModel,
  ArtifactTypes,
  atype_to_hub_map,
  PayloadKojiBuild,
} from './db_interface';
import { THandler, customMerge, THandlersSet } from './msg_handlers';
import { assert_is_valid } from './validation';
import { FileQueueMessage } from './fqueue';

const log = debug('kaijs:msg_handlers_koji');

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
const handler_buildsys_tag = async (
  type: ArtifactTypes,
  artifacts: Artifacts,
  fq_msg: FileQueueMessage
): Promise<ArtifactModel> => {
  assert.ok(
    _.has(atype_to_hub_map, type),
    `handler_buildsys_tag() was called for unknown artifact type: ${type}`
  );
  const hub_name: KojiHubName = _.get(atype_to_hub_map, type);
  const { body } = fq_msg;
  const { build_id } = body;
  var buildInfo;
  try {
    buildInfo = await koji_query(hub_name, 'getBuild', build_id);
  } catch (err) {
    log(
      ' [E] handler_buildsys_tag cannot get buildInfo for build_id: %s',
      body.build_id
    );
    throw err;
  }
  assert_is_valid(buildInfo, 'koji_build_info');
  const task_id = _.toString(buildInfo.task_id);
  var artifact;
  try {
    artifact = await artifacts.findOrCreate(type, _.toString(task_id));
  } catch (err) {
    log(' [E] handler_buildsys_tag failed for task_id: %s', task_id);
    throw err;
  }
  const newPayload: PayloadKojiBuild = {
    task_id,
    build_id: _.toString(build_id),
    nvr: _.get(buildInfo, 'nvr'),
    issuer: body.owner,
    source: _.get(buildInfo, 'extra.source.original_url'),
    scratch: false,
    component: _.get(buildInfo, 'name'),
  };
  /**
   * Mutate artifact.rpm_build, assign any way, if artifact.rpm_build was undefined before
   */
  artifact.payload = _.mergeWith(artifact.payload, newPayload, customMerge);
  log(' [i] handler_buildsys_tag updated doc: %s%o', '\n', artifact);
  return artifact;
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
  _.partial(handler_buildsys_tag, 'koji-build-cs')
);

handlers.set(
  /^org.fedoraproject.prod.buildsys.tag$/,
  _.partial(handler_buildsys_tag, 'koji-build')
);
