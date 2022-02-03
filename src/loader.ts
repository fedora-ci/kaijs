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

import _, { isBuffer } from 'lodash';
import Joi from 'joi';
import debug from 'debug';

import {
  fqueue as fq,
  FileQueueCallback,
  FileQueueEntry,
  FileQueueMessage,
} from './fqueue';
import { getcfg, mkDirParents } from './cfg';
import { NoAssociatedHandlerError } from './dbMsgHandlers';
import {
  Artifacts,
  ValidationErrors,
  UnknownBrokerTopics,
  get_collection,
} from './db';
/** Wire-in pino and debug togather. */
require('./pino_logger');

const log = debug('kaijs:loader');
const cfg = getcfg();
import { schemas } from './validation';
import { metrics_up_fq, metrics_up_parse } from './metrics';
/** absolute path to present dump dir */
var file_queue_path: string;
const file_queue_path_cfg = cfg.loader.file_queue_path;
/** absolute path to present dump dir */
var file_queue_path: string;
var fqueue: any;

/**
 * There are two messages types:
 * 1) msg from file-queue from listener. Variable prefix: fq_ or file_queue_
 * 2) msg from amqp-broker: Variable prefix: broker_
 */

async function handle_signal(
  fqueue: any,
  artifacts: Artifacts,
  validation_errors: ValidationErrors,
  signal: NodeJS.Signals
): Promise<void> {
  log(`Received: ${signal}. Closing connection to filequeue and db.`);
  /*
   * Initiate graceful closing.
   */
  log(' [i] Stop monitoring the file queue directories');
  fqueue.stop();
  log(' [i] Close the db and its underlying connections');
  artifacts.close();
  validation_errors.close();
  log('Clean exit');
  process.exit(0);
}

async function start(): Promise<never> {
  file_queue_path = mkDirParents(file_queue_path_cfg);
  log('File-queue path: %s', file_queue_path);
  fqueue = await fq.make(file_queue_path);
  log('File-queue length at start: %s', await fq.length(fqueue));
  var artifacts: Artifacts;
  var validation_errors: ValidationErrors;
  var no_handlers: UnknownBrokerTopics;
  try {
    artifacts = (await get_collection('artifacts')) as Artifacts;
    validation_errors = (await get_collection('invalid')) as ValidationErrors;
    no_handlers = (await get_collection('no_handler')) as UnknownBrokerTopics;
  } catch (error) {
    console.warn('Whoops! Cannot connect to db.', error);
    process.exit(1);
  }
  const clean_on: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGABRT'];
  for (const signal of clean_on) {
    process.once(
      signal,
      _.curry(handle_signal)(fqueue, artifacts, validation_errors)
    );
  }
  while (true) {
    let fq_msg: FileQueueMessage;
    let fq_commit: FileQueueCallback, fq_rollback: FileQueueCallback;
    try {
      const { message, commit, rollback }: FileQueueEntry = await fq.tpop(
        fqueue
      );
      [fq_msg, fq_commit, fq_rollback] = [message, commit, rollback];
    } catch (err) {
      console.warn('Cannot get msg from file-queue', err);
      process.exit(1);
    }
    const parse_err = _.attempt(Joi.assert, fq_msg, schemas['fq_msg']);
    if (_.isError(parse_err)) {
      fq_commit((err: Error) => {
        if (err) throw err;
      });
      metrics_up_fq('nack');
      metrics_up_parse('fq_msg', 'err');
      log(
        ' [E] Cannot parse received message from file-queue. Dropping message:%s%s',
        '\n',
        parse_err.message
      );
      continue;
    }
    const fq_length = await fq.length(fqueue);
    try {
      log(
        ' [i] Adding message to DB with file-queue message id %O. Remain unprocessed messages: %s',
        fq_msg.fq_msg_id,
        fq_length
      );
      await artifacts.add_to_db(fq_msg);
    } catch (err) {
      if (err instanceof Joi.ValidationError) {
        /**
         * Store broker-message that cannot be validated to special DB.
         */
        log(
          ' [E] Validation error. Store message to invalid messages db. Message with broker msg-id: %s and file-queue message-id: %s.\nValidation error: %s.\nMessage content:%O',
          fq_msg.broker_msg_id,
          fq_msg.fq_msg_id,
          err.message,
          fq_msg
        );
        metrics_up_fq('nack');
        try {
          await validation_errors.add_to_db(fq_msg, err);
          log(
            ' [i] stored invalid message. Broker msg-id %s.',
            fq_msg.broker_msg_id
          );
        } catch (err) {
          /** The message  */
          if (_.isError(err)) {
            console.warn(
              ' [E] Cannot store invalid message with broker msg-id: %s and file-queue message-id: %s.\nError: %s.',
              fq_msg.broker_msg_id,
              fq_msg.fq_msg_id,
              err.message
            );
            /** At this point message stays un-acked at file-queue */
            log(
              ' [i] Make file-queue item again available for popping. Broker msg-id: %s.',
              fq_msg.broker_msg_id
            );
            fq_rollback((err: Error) => {
              if (err) throw err;
            });
            /**
             * Exit from programm.
             */
            process.exit(1);
          } else {
            throw err;
          }
        }
      } else if (err instanceof NoAssociatedHandlerError) {
        /**
         * Store message that doesn't have associated handler
         */
        log(' [E] %s', err.message);
        log(
          ' [E] Store message to no-handler db. Broker msg-id: %s, file-queue message-id: %s.',
          fq_msg.broker_msg_id,
          fq_msg.fq_msg_id
        );
        metrics_up_fq('nack');
        try {
          await no_handlers.add_to_db(fq_msg, err);
        } catch (err) {
          /** The message  */
          if (_.isError(err)) {
            console.warn(
              ' [E] Cannot store invalid message with broker msg-id: %s and file-queue message-id: %s.\nError: %s.',
              fq_msg.broker_msg_id,
              fq_msg.fq_msg_id,
              err.message
            );
          } else {
            throw err;
          }
        }
      } else {
        if (_.isError(err)) {
          console.warn(
            ' [E] Cannot update DB with received message.',
            `File-queue message id: ${fq_msg.fq_msg_id}`,
            'Error is:',
            err.message
          );
        } else {
          throw err;
        }
        log(
          ' [i] Make file-queue item again available for popping. Broker msg-id: %s.',
          fq_msg.broker_msg_id
        );
        fq_rollback((err: Error) => {
          if (err) throw err;
        });
        /**
         * Exit from programm.
         */
        process.exit(1);
      }
    }
    metrics_up_fq('ack');
    /**
     * Message was processed. Release message from file-queue.
     */
    log(' [i] Message was processed. Broker msg-id %s.', fq_msg.broker_msg_id);
    fq_commit((err: Error) => {
      if (err) throw err;
    });
  }
}

start().catch((error) => {
  console.warn(error);
  process.exit(1);
});
