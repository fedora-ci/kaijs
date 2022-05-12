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
 * draft-07 (and draft-06)
 *
 * ResultsDB follows: SpecVersion.VersionFlag.V7
 * https://gitlab.cee.redhat.com/Workflow_Integration/hydra-sp/umb-notifier/-/blob/master/src/main/java/com/redhat/integration/umbnotifier/services/JsonSchemaValidator.java#L14
 */
import _ from 'lodash';
import Ajv from 'ajv';
import debug from 'debug';
import util from 'util';
import yaml from 'js-yaml';
import assert from 'assert';
import addFormats from 'ajv-formats';

import { FileQueueMessage } from './fqueue';
import { getFileFromGitRepo } from './get_schema';

const log = debug('kaijs:validation_ajv');

export class AJVValidationError extends Error {
  constructor(message: string) {
    super(message);
    /**
     * Set the prototype explicitly.
     */
    Object.setPrototypeOf(this, AJVValidationError.prototype);
  }
}

/**
 * https://ajv.js.org/guide/managing-schemas.html#asynchronous-schema-loading
 */
const schemaResolver = async (
  version: string,
  uri: string
): Promise<object> => {
  const tag = version;
  const uriYaml = _.replace(uri, /\.json$/, '.yaml');
  const schemaPathInGitRepo = `schemas/${uriYaml}`;
  log(' [i] getting schema for ver: %s %s', tag, schemaPathInGitRepo);
  const schemaText = await getFileFromGitRepo(tag, schemaPathInGitRepo);
  const schema = yaml.load(schemaText);
  assert.ok(
    _.isObject(schema),
    `Error to get schema for ver: ${version} at path: ${uri}`
  );
  return schema;
};

const getAjv_ = (version: string) => {
  const resolver = _.partial(schemaResolver, version);
  const ajv = new Ajv({ loadSchema: resolver });
  addFormats(ajv);
  return ajv;
};

/** 1 copy of ajv per same git-tag */
const getAjv = _.memoize(getAjv_);

const getSchema = async (version: string, schemaName: string) => {
  log('[i] getting schema for %s:%s', version, schemaName);
  const ajv = getAjv(version);
  const schema = await schemaResolver(version, schemaName);
  const cacheKeyId = _.get(schema, '$id');
  if (!_.isString(cacheKeyId) || _.isEmpty(cacheKeyId)) {
    throw new Error(`Bad $id for ${version}:${schemaName}`);
  }
  /* https://ajv.js.org/guide/managing-schemas.html#pre-adding-all-schemas-vs-adding-on-demand */
  let validate = ajv.getSchema(cacheKeyId);
  if (!validate) {
    log('[i] compiling schema for %s:%s', version, schemaName);
    validate = await ajv.compileAsync(schema);
  }
  return validate;
};

const getSchemaName = (brokerTopic: string): string => {
  /**
   * Schema name == 3 last component from topic
   *
   * Example:
   *
   * From: /topic/VirtualTopic.eng.ci.osci.brew-build.test.complete
   * Produces: brew-build.test.complete
   */
  const schemaName = _.chain(brokerTopic)
    .split('.')
    .takeRight(3)
    .join('.')
    .value();
  return schemaName;
};

/** Replaces all throws with AJVValidationError */
export const assertMsgIsValidAJV = async (
  message: FileQueueMessage
): Promise<void> => {
  const { broker_topic, broker_msg_id } = message;
  /** Even though schemas are defined in yaml, internally they do: $ref: test-common.json */
  let valid;
  let schemaName;
  let version: string;
  let validate;
  try {
    schemaName = getSchemaName(broker_topic) + '.json';
    version = _.get(message.body, 'version');
    validate = await getSchema(version, schemaName);
    valid = validate(message.body);
  } catch (err) {
    if (_.isError(err)) {
      throw new AJVValidationError(err.message);
    }
    throw err;
  }
  log(
    '[i] %s %s:%s validation result: %s',
    broker_msg_id,
    version,
    schemaName,
    valid
  );
  const errMsg = `[E] ${version}:${schemaName}: validation error: ${util.format(
    '%O',
    validate.errors
  )}}`;
  assert.ok(valid, new AJVValidationError(errMsg));
};

/**
const msgSample1: FileQueueMessage = {
  body: {
    artifact: {
      baseline: 'redis-6.2.7-1.el9',
      component: 'redis',
      id: 45186884,
      issuer: 'distrobaker/distrobaker.osci.com',
      nvr: 'redis-6.2.7-1.el9',
      scratch: false,
      source:
        'git://pkgs.devel.com/rpms/redis#b59a940395a2f5bc77f1bda97a205ed9bb38fa4f',
      type: 'brew-build',
    },
    contact: {
      docs: 'https://gitlab.cee.com/osci-pipelines/gating-yaml-pipeline/-/blob/master/README.md',
      email: 'osci-list@com',
      irc: '#osci',
      name: 'gating-yaml',
      team: 'OSCI',
    },
    generated_at: '2022-05-10T12:47:56.425Z',
    pipeline: {
      build: '10480',
      id: 'bbd3ca1301890c03b0b1f91a1f02f9a05b37be8ee4882b8241172571c25fc66e',
      name: 'gating-yaml',
    },
    run: {
      debug:
        'https://cyborg-jenkins/job/OSCI-Pipelines/job/osci-pipelines%252Fgating-yaml-pipeline/job/master/10480/console',
      log: 'https://cyborg-jenkins/job/OSCI-Pipelines/job/osci-pipelines%252Fgating-yaml-pipeline/job/master/10480/console',
      log_raw:
        'https://cyborg-jenkins.osci/job/OSCI-Pipelines/job/osci-pipelines%252Fgating-yaml-pipeline/job/master/10480/consoleText',
      log_stream:
        'https://cyborg-jenkins.osci/job/OSCI-Pipelines/job/osci-pipelines%252Fgating-yaml-pipeline/job/master/10480/console',
      rebuild:
        'https://cyborg-jenkins.osci/job/OSCI-Pipelines/job/osci-pipelines%252Fgating-yaml-pipeline/job/master/10480/rebuild',
      url: 'https://cyborg-jenkins.osci/job/OSCI-Pipelines/job/osci-pipelines%252Fgating-yaml-pipeline/job/master/10480/artifact/test.log/*view*',
    },
    system: [],
    test: {
      category: 'validation',
      docs: 'https://gitlab.cee/osci-pipelines/gating-yaml-pipeline/-/blob/master/README.md',
      namespace: 'osci.brew-build',
      result: 'passed',
      type: 'gating-yaml',
      xunit: 'H4sIAAAAAAAAAH2Rgf1noxI3QEAAA==',
    },
    version: '1.1.14',
  },
  broker_msg_id: 'ID:cyborg-jenkins-32945-1651582715230-18355:1:1:1:1',
  broker_topic: 'VirtualTopic.eng.ci.osci.brew-build.test.complete',
  fq_msg_id:
    '1652188265686-ID:cyborg-jenkins-32945-1651582715230-18355:1:1:1:1',
  provider_name: 'vdbfetch',
  provider_timestamp: 1652188265686,
};

const msgSample2: FileQueueMessage = {
  body: { version: '1.1.14' },
  broker_msg_id: 'ID:cyborg-jenkins-32945-1651582715230-18355:1:1:1:1',
  broker_topic: 'VirtualTopic.eng.ci.osci.brew-build.test.error',
  fq_msg_id:
    '1652188265686-ID:cyborg-jenkins-32945-1651582715230-18355:1:1:1:1',
  provider_name: 'vdbfetch',
  provider_timestamp: 1652188265686,
};

*/

/**
 * Standalone run, uncomment next line and invoke:
 * DEBUG="osci:*,kaijs:*" ts-node validation_ajv.ts

(async () => {
  await assertMsgIsValidAJV(msgSample1);
  await assertMsgIsValidAJV(msgSample2);
})();
 */
