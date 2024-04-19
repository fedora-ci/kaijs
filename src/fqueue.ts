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
 * Based on https://github.com/threez/file-queue
 */

import _ from 'lodash';
import fs from 'fs';
import debug from 'debug';
const graceful_fs = require('graceful-fs');
const { Queue } = require('file-queue');

const log = debug('kaijs:fqueue');

export type FileQueueCallback = (cb: (err: Error) => void) => void;

export interface FileQueueEntry {
  message: FileQueueMessage;
  commit: FileQueueCallback;
  rollback: FileQueueCallback;
}

export interface FileQueueMessage {
  /** File-queue message id */
  fq_msg_id: string;
  /** Msg ID, known in UMB/RabbitMQ broker */
  broker_msg_id: string;
  /** UMB/RabbitMQ topic */
  broker_topic: string;
  /** Any string, for example: "virtualdb" or "kai-listener-umb" */
  provider_name: string;
  /** When provider received message */
  provider_timestamp: number;
  /** Timestamp from message header */
  header_timestamp?: number;
  /** Payload of message */
  body: { [key: string]: any };
  /** Message headers */
  broker_extra: { [key: string]: any };
}

async function make(path: string, opts = { poll: false, optimizeList: false }) {
  return new Promise((resolve, reject) => {
    var queue = new Queue(
      {
        path,
        fs: graceful_fs,
      },
      function (err: Error) {
        if (err) return reject(err);
        /**
         * https://github.com/threez/file-queue/issues/8
         * This code is based on assumption, that
         * https://github.com/threez/file-queue/blob/6f2bfa60fda2205801ca1c558f4cfc1536e8825c/queue.js#L28
         * function(messages) {} - ignores its argument and checks actual presence of messages.
         */
        if (opts.poll) {
          log(' [i] enable polling for new messages');
          setInterval(() => {
            log(' [i] polling-tick to check new messages');
            queue.maildir.emit('new');
          }, 1000 * 60);
        }
        if (opts.optimizeList) {
          /*
           * https://github.com/threez/file-queue/issues/6
           */
          log(' [i] file-queue: hijack listNew method.');
          queue.maildir.listNew = function (
            callback: (err: Error | null, files?: string[] | null) => {},
          ) {
            let len = 32;
            const NEW = 1;
            const files: string[] = [];
            const dir = fs.opendirSync(queue.maildir.dirPaths[NEW]);
            while (len) {
              let file;
              try {
                file = dir.readSync();
              } catch (err) {
                const code = _.get(err, 'code');
                if (code === 'ENOENT') {
                  /* file was stealed by other runner */
                  break;
                } else {
                  throw err;
                }
              }
              if (!file) {
                break;
              }
              files.push(file.name);
              len--;
            }
            dir.closeSync();
            callback(null, files);
          };
        }
        resolve(queue);
      },
    );
  });
}

async function push(fqueue: any, obj: any): Promise<void> {
  return new Promise((resolve, reject) => {
    fqueue.push(obj, function (err: Error) {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function pop(fqueue: any): Promise<any> {
  return new Promise((resolve, reject) => {
    fqueue.pop(function (err: Error, message: any) {
      if (err) return reject(err);
      resolve(message);
    });
  });
}

/**
 * Transactional popping
 * A transactional pop means, that the element is taken from the queue,
 * but will not be removed until commit is called. The rollback action
 * makes the item again available for popping.
 */
async function tpop(fqueue: any): Promise<any> {
  return new Promise((resolve, reject) => {
    fqueue.tpop(function (
      err: Error,
      message: any,
      commit: any,
      rollback: any,
    ) {
      if (err) return reject(err);
      resolve({ message, commit, rollback });
    });
  });
}

async function length(fqueue: any): Promise<any> {
  return new Promise((resolve, reject) => {
    fqueue.length(function (err: Error, length: number) {
      if (err) return reject(err);
      resolve(length);
    });
  });
}

async function clear(fqueue: any): Promise<void> {
  return new Promise((resolve, reject) => {
    fqueue.clear(function (err: Error) {
      if (err) return reject(err);
      resolve();
    });
  });
}

export const fqueue = {
  make,
  push,
  pop,
  length,
  clear,
  /** Transactional popping */
  tpop,
};
