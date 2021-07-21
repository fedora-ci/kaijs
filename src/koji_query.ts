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

/**
 * DEBUG="${DEBUG:-kaijs:*}" ./node_modules/.bin/ts-node src/koji_query.ts | ./node_modules/.bin/pino-pretty
 */

import xmlrpc from 'xmlrpc';
import debug from 'debug';
import { getcfg } from './cfg';
require('./pino_logger');

const log = debug('kaijs:koji_query');
const cfg = getcfg();

var client = xmlrpc.createSecureClient(cfg.koji_fp);

interface BuildInfo {
  cg_id: null;
  completion_time: string;
  completion_ts: number;
  creation_event_id: number;
  creation_time: string;
  creation_ts: number;
  epoch: null;
  extra: { source: { original_url: string } };
  id: number;
  name: string;
  nvr: string;
  owner_id: number;
  owner_name: string;
  package_id: number;
  package_name: string;
  release: string;
  source: string;
  start_time: string;
  start_ts: number;
  state: number;
  task_id: number;
  version: string;
  volume_id: number;
  volume_name: string;
  cg_name: null;
}

interface TagInfo {
  cg_id: null;
}

export const getBuild = async (buildID: number): Promise<BuildInfo> => {
  log(' [i] Query for buildID: %s', buildID);
  return new Promise((resolve, reject) => {
    client.methodCall(
      'getBuild',
      [buildID],
      function (error: any, value: any): void {
        if (error) {
          console.log('error:', error);
          console.log('req headers:', error.req && error.req._header);
          console.log('res code:', error.res && error.res.statusCode);
          console.log('res body:', error.body);
          reject(error);
        } else {
          log("Response for 'getBuild': %s %o", '\n', value);
          resolve(value);
        }
      }
    );
  });
};

async function start(): Promise<void> {
  const bi = await getBuild(1741258);
  console.log('Hi');
  log('BuildInfo: %O', bi);
}

start().catch((error) => {
  console.warn(error);
  process.exit(1);
});
