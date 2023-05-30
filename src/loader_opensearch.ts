/* This file is part of kaijs

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
import Joi from 'joi';
import debug from 'debug';
import cron from 'node-cron';

import {
  fqueue as fq,
  FileQueueCallback,
  FileQueueEntry,
  FileQueueMessage,
} from './fqueue';
import { getcfg, mkDirParents } from './cfg';
import { getAllSchemas } from './get_schema';

import {
  Update,
  printify,
  getMsgUpdates,
  OpensearchClient,
} from './opensearch/opensearch';

import { schemas } from './validation';
import { OrderedBulkOperation } from 'mongodb';

/** Wire-in pino and debug togather. */
require('./pino_logger');

const log = debug('kaijs:loader_opensearch');
const cfg = getcfg();
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
  opensearchClient: OpensearchClient,
  signal: NodeJS.Signals,
): Promise<void> {
  log(`Received: ${signal}. Closing connection to filequeue and db.`);
  /*
   * Initiate graceful closing.
   */
  log(' [i] Stop monitoring the file queue directories');
  fqueue.stop();
  log(' [i] Close the db and its underlying connections');
  opensearchClient.close();
  log('Clean exit');
  process.exit(0);
}

/**
 * The encodeURI() function replaces each non-ASCII character in the string with a percent-encoded representation,
 * which is a sequence of three characters. By splitting the encoded string on these sequences and counting the resulting
 * array length, we can determine the number of bytes in the original string.
 */
function getObjectSize(obj: any): number {
  if (!obj) {
    return 0;
  }
  const objectString = JSON.stringify(obj);
  const utf8Length = encodeURI(objectString).split(/%..|./).length - 1;
  return utf8Length;
}

function rollbackFqMessages(fqEntries: FileQueueEntry[]) {
  for (let fq_entry of fqEntries) {
    log(
      ' [i] Make file-queue item again available for popping. Broker msg-id: %s.',
      fq_entry.message.broker_msg_id,
    );
    fq_entry.rollback((err: Error) => {
      if (err) throw err;
    });
  }
}

function commitFqMessages(fqEntries: FileQueueEntry[]) {
  for (let fq_entry of fqEntries) {
    /**
     * Message was processed. Release message from file-queue.
     */
    log(
      ' [i] Message was processed. Broker msg-id %s.',
      fq_entry.message.broker_msg_id,
    );
    fq_entry.commit((err: Error) => {
      if (err) throw err;
    });
  }
}

const rollbackAndExit = (
  err: unknown,
  fqEntries: FileQueueEntry[],
  fq_msg?: FileQueueMessage,
) => {
  if (_.isError(err)) {
    /** err object can have many different properties. To dump all details abot err we use printify */
    log(
      ' [E] Cannot update DB with received messages. Error is: %s',
      printify(err),
    );
    if (fq_msg) {
      log(' [E] Message that coused error: %s', printify(fq_msg));
    }
  } else {
    throw err;
  }
  rollbackFqMessages(fqEntries);
  /**
   * Exit from programm.
   */
  process.exit(1);
};

async function start(): Promise<never> {
  file_queue_path = mkDirParents(file_queue_path_cfg);
  log('File-queue path: %s', file_queue_path);
  fqueue = await fq.make(file_queue_path, { poll: true, optimizeList: true });
  log('File-queue length at start: %s', await fq.length(fqueue));
  var opensearchClient: OpensearchClient;
  try {
    opensearchClient = new OpensearchClient();
    await opensearchClient.init();
  } catch (error) {
    console.warn('Whoops! Cannot init opensearch.', error);
    process.exit(1);
  }
  const clean_on: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGABRT'];
  for (const signal of clean_on) {
    process.once(signal, _.curry(handle_signal)(fqueue, opensearchClient));
  }
  /** Do not process messages until we have local copy of the git-repo with messages schemas */
  await getAllSchemas();
  /**
   * Update schemas each 12 hours:
   */
  const cronExprShemas = '2 */12 * * *';
  log(
    ' [i] schedule cron task to update schemas. Cron cfg: %s',
    cronExprShemas,
  );
  cron.schedule(cronExprShemas, getAllSchemas);

  let fqEntries: FileQueueEntry[] = [];
  let bulkUpdates: Update[] = [];
  let bulkSizeBytes = 0;
  let prevMsgTime = new Date();
  const bulkSecondsThreshold = 3;
  const bulkMaxEntries = 100;
  /** 50MB: bulk max size, to pass HTTPS request + 1 message in size 50MB. */
  const bulkMaxSize = 1024 * 1024 * 1024 * 50;

  while (true) {
    let fq_msg: FileQueueMessage;
    let fq_entry: FileQueueEntry;
    let fq_commit: FileQueueCallback;
    try {
      log(' [i] Waiting for next fq message...');
      fq_entry = await fq.tpop(fqueue);
      [fq_msg, fq_commit] = [
        fq_entry.message,
        fq_entry.commit,
        fq_entry.rollback,
      ];
    } catch (err) {
      console.warn('Cannot get msg from file-queue', err);
      process.exit(1);
    }
    const parse_err = _.attempt(Joi.assert, fq_msg, schemas['fq_msg'], {
      allowUnknown: true,
    });
    if (_.isError(parse_err)) {
      fq_commit((err: Error) => {
        if (err) throw err;
      });
      log(
        ' [E] Cannot parse received message from file-queue. Dropping message:%s%s',
        '\n',
        parse_err.message,
      );
      continue;
    }
    log(
      ' [i] Adding message to DB with file-queue message id %O.',
      fq_msg.fq_msg_id,
    );
    fqEntries.push(fq_entry);
    const newMsgTime = new Date();
    const secondsBetweenMessages =
      (newMsgTime.getTime() - prevMsgTime.getTime()) / 1000;
    prevMsgTime = newMsgTime;
    let msgUpdates: Update[];
    try {
      /** Can produce 0 updates, for example when message is discarded */
      msgUpdates = await getMsgUpdates(fq_msg);
    } catch (err) {
      rollbackAndExit(err, fqEntries, fq_msg);
      /** TS cannot track exit in previous function call */
      process.exit(1);
    }
    log(
      ' [I] msg with id %s produced %s updates',
      fq_msg.broker_msg_id,
      msgUpdates.length,
    );
    const updatesSizeBytes = _.sum(
      _.map(msgUpdates, (update) => {
        /** Note: next calculation is not strict, since there is a dependecy on doc_as_upsert parameter. Approximate calculations is also OK. */
        return _.max([getObjectSize(update.doc), getObjectSize(update.upsert)]);
      }),
    );
    bulkSizeBytes += updatesSizeBytes;
    bulkUpdates = [...bulkUpdates, ...msgUpdates];
    if (
      (secondsBetweenMessages < bulkSecondsThreshold &&
        bulkUpdates.length < bulkMaxEntries &&
        bulkSizeBytes < bulkMaxSize) ||
      bulkUpdates.length === 0
    ) {
      continue;
    }
    log(' [I] bulkSizeBytes: %s', bulkSizeBytes);
    try {
      await opensearchClient.bulkUpdate(bulkUpdates);
      bulkUpdates = [];
      bulkSizeBytes = 0;
      commitFqMessages(fqEntries);
      fqEntries = [];
    } catch (err) {
      rollbackAndExit(err, fqEntries);
    }
  }
}

start().catch((error) => {
  console.warn(error);
  process.exit(1);
});
