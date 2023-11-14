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

import _ from 'lodash';
import debug from 'debug';
import assert from 'assert';
import crypto from 'crypto';
import { FileQueueMessage } from '../fqueue';
import { assert_is_valid } from '../validation';
import { handlers as handlersEta } from './msg_handlers_eta';
import { handlers as handlersBrew } from './msg_handlers_brew';
import { handlers as handlersKoji } from './msg_handlers_koji';
import { handlers as handlersTest } from './msg_handlers_test';
import { MessageData, TSearchable, Update } from './opensearch';

const log = debug('kaijs:msg_handlers');

export type TGetSearchable = (body: any) => TSearchable;
export type THandler = (fq_msg: FileQueueMessage) => Promise<Update[]>;
export type THandlersSet = Map<RegExp, THandler>;
export type TSearchableHandlersSet = Map<RegExp, TGetSearchable>;

export class NoAssociatedHandlerError extends Error {
  constructor(m: string, public broker_topic: string) {
    super(m);
    /**
     * Set the prototype explicitly.
     */
    Object.setPrototypeOf(this, NoAssociatedHandlerError.prototype);
  }
}

export class NoNeedToProcessError extends Error {
  constructor(m: string, public broker_topic: string) {
    super(m);
    /**
     * Set the prototype explicitly.
     */
    Object.setPrototypeOf(this, NoNeedToProcessError.prototype);
  }
}

export class NoThreadIdError extends Error {
  constructor(m: string) {
    super(m);
    /**
     * Set the prototype explicitly.
     */
    Object.setPrototypeOf(this, NoThreadIdError.prototype);
  }
}

/** messages can be for different stages: test / build */
export const mkThreadId = (fq_msg: FileQueueMessage) => {
  const { broker_msg_id, body, broker_topic } = fq_msg;
  const threadIdV1 = _.get(body, 'pipeline.id');
  const threadIdV01 = _.get(body, 'thread_id');
  let threadId = _.find(
    [threadIdV1, threadIdV01],
    _.flow(_.identity, _.overEvery([_.negate(_.isEmpty), _.isString])),
  );
  if (threadId) {
    log(
      ' [i] take a thread id for msg-id %s from message: %s',
      broker_msg_id,
      threadId,
    );
    return threadId;
  }
  /**
   * No thread-id in message.
   * Generate a dummy thread id
   */
  const hashAnchorParts = [];
  const runUrl = _.get(body, 'run.url');
  if (!_.isEmpty(runUrl) && _.isString(runUrl)) {
    hashAnchorParts.push(runUrl);
  }
  if (isTestStage(broker_topic)) {
    var testCaseName = makeTestCaseName(body);
    hashAnchorParts.push(testCaseName);
  }
  if (_.isEmpty(hashAnchorParts)) {
    throw new NoThreadIdError(
      `Cannot make thread-id for broker msg-id: ${broker_msg_id}`,
    );
  }
  /**
   * if msg_body.pipeline.id is absent generate a dummy thread_id based on
   * msg_body.run.url
   * if msg_body.run.url is abset too -> NACK this message
   * msg_body.run is required entry according to schema:
   * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/run.yaml#_59
   *
   * Old code:
   *
   * dummy_thread_id = 'dummy-thread-{}'.format(hashlib.sha256('{}-{}-{}-{}-{}'.format(
   *           body.get('ci', {}).get('url', body.get('ci', {}).get('name', '')),
   *           body['run']['url'],
   *           body.get('stage', 'test'),
   *           body.get('category', 'functional'),
   *           body.get('type', 'tier1'))).hexdigest())
   *
   */
  const hashAnchor = _.join(hashAnchorParts, '~');
  const hash = crypto.createHash('sha256').update(hashAnchor).digest('hex');
  threadId = `dummy-thread-${hash}`;
  log(' [i] generate a thread id for msg-id: %s : %s', broker_msg_id, threadId);
  return threadId;
};

export function isMsgV1(body: any): boolean {
  return body.version.startsWith('0.2.') || body.version.startsWith('1.');
}

export function isMsgV0(msg: any): boolean {
  return msg.version.startsWith('0.1.');
}

export function isBuildStage(broker_topic: string): boolean {
  const stage = _.nth(_.split(broker_topic, '.'), -2) as string;
  return stage === 'build';
}

export function isTestStage(broker_topic: string): boolean {
  const stage = _.nth(_.split(broker_topic, '.'), -2) as string;
  return stage === 'test';
}

export const makeTestCaseName = (body: any): string => {
  let testCaseName: string = '';
  if (isMsgV1(body)) {
    const namespace = _.get(body, 'test.namespace');
    const type = _.get(body, 'test.type');
    const category = _.get(body, 'test.category');
    if (_.size(namespace) && _.size(type) && _.size(category)) {
      testCaseName = `${namespace}.${type}.${category}`;
    }
  } else if (isMsgV0(body)) {
    const namespace = _.get(body, 'namespace');
    const type = _.get(body, 'type');
    const category = _.get(body, 'category');
    if (_.size(namespace) && _.size(type) && _.size(category)) {
      testCaseName = `${namespace}.${type}.${category}`;
    }
  }
  assert_is_valid(testCaseName, 'test_case_name');
  return testCaseName;
};

/** Messages can be for different stages: test / build */
export const makeMessageData = (fq_msg: FileQueueMessage): MessageData => {
  const { broker_topic, broker_msg_id, body, broker_extra } = fq_msg;
  const messageData = {
    brokerExtra: broker_extra,
    brokerMsgId: broker_msg_id,
    brokerMsgBody: body,
    brokerMsgTopic: broker_topic,
  };
  return messageData;
};

const getSearchableHandlerByMsgVersion = (
  msgBody: any,
  handlerSet: TSearchableHandlersSet,
): TGetSearchable => {
  const version = _.get(msgBody, 'version');
  const regexAndHandler = _.find<[RegExp, TGetSearchable]>(
    _.toArray(handlerSet as any),
    ([regex, _h]) => regex.test(version),
  );
  assert.ok(
    _.isArray(regexAndHandler),
    `Cannot find handler for version: ${version}`,
  );
  const [_r, handler] = regexAndHandler;
  return handler;
};

const allKnownHandlers: THandlersSet = new Map<RegExp, THandler>();

export const mkSearchable = (
  body: any,
  payloadHandlers: TSearchableHandlersSet,
): TSearchable => {
  const getPayload = getSearchableHandlerByMsgVersion(body, payloadHandlers);
  const payload = getPayload(body);
  return payload;
};

/**
 * Populate all allKnownHandlers for each category
 */
handlersTest.forEach((value, key) => allKnownHandlers.set(key, value));
handlersBrew.forEach((value, key) => allKnownHandlers.set(key, value));
handlersKoji.forEach((value, key) => allKnownHandlers.set(key, value));
handlersEta.forEach((value, key) => allKnownHandlers.set(key, value));

log(
  ' [i] known handlers: %O',
  _.map([...allKnownHandlers], ([re]) => _.toString(re)),
);

export function getHandler(broker_topic: string): THandler {
  return _.last(
    _.find([...allKnownHandlers], ([re]) => re.test(broker_topic)) as
      | Array<any>
      | undefined,
  );
}

const escapeString = (str: string): string => {
  return str.replace(/[\\"']/g, '\\$&').replace(/\u0000/g, '\\0');
};

/**
 * Reimplement JSON.stringify(), without: {}[]":
 */
export const messageToString = (obj: any): string | undefined => {
  const maxLength = 400;

  if (_.isNull(obj)) {
    return 'null';
  }

  if (_.isUndefined(obj)) {
    return undefined;
  }

  if (_.isString(obj)) {
    const truncatedString = _.truncate(obj, {
      length: maxLength,
    });
    return escapeString(truncatedString);
  }

  if (_.isNumber(obj) || _.isBoolean(obj)) {
    return obj.toString();
  }

  if (_.isArray(obj)) {
    const arrayValues = _.map(obj, (item) => messageToString(item));
    return arrayValues.join(' ');
  }

  if (_.isObject(obj)) {
    const objectProperties = _.map(
      obj,
      (value, _key) => `${messageToString(value)}`,
    );
    return objectProperties.join(' ');
  }
};
