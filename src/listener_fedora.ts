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

import fs from 'fs';
import _ from 'lodash';
import debug from 'debug';
import crypto from 'crypto';
import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import amqp, { credentials } from 'amqplib';
const { isFatalError } = require('amqplib/lib/connection');
import { fqueue as fq, FileQueueMessage, FileQueueEntry } from './fqueue';
import { getcfg, mkDirParents } from './cfg';
/** Wire-in pino and debug togather. */
require('./pino_logger');

const listener_name = 'kaijs-listener';
const log = debug('kaijs:listener');
const cfg = getcfg();
const broker_cfg = cfg.listener.broker_rabbitmq;
const topics_cfg = cfg.listener.broker_rabbitmq.topics.set;
log('Active config: %s, %O', '\n', cfg.listener.broker_rabbitmq);
const file_queue_path_cfg = cfg.listener.file_queue_path;
/** absolute path to present dump dir */
var file_queue_path: string;
var fqueue: any;

/*
 * This code is based on upstream tutorials: https://www.rabbitmq.com/getstarted.html
 * RabbitMQ supports different protocols: https://www.rabbitmq.com/connections.html
 * We use AMQP 0-9-1 protocol.
 * Library amqplib implements AMQP 0-9-1 : http://www.squaremobius.net/amqp.node/
 * The library supports: promises and callbacks.
 * In this client we use promises style.
 * Do not mix promises and callbacks styles when work with this library.
 * https://github.com/squaremo/amqp.node examples and tests, where you can inspire from.
 *
 * Fedora public broker sets limit to queue: 50MB:
 * Fedora broker also removes durable queues if there is no consumer for 1 hour.
 * https://fedora-messaging.readthedocs.io/en/stable/quick-start.html#fedora-s-public-broker
 *
 * Messages can be retrieved at:
 * https://apps.fedoraproject.org/datagrepper/id?id=<year>-<msg_id>&is_raw=true&size=extra-large
 * https://github.com/fedora-infra/datanommer/blob/develop/datanommer.models/datanommer/models/__init__.py#L130-L134
 */

const socketOptions = {
  /*
   * Supply params to tls library.
   * http://www.squaremobius.net/amqp.node/channel_api.html#api_reference
   * Part of options goes to https://nodejs.org/api/tls.html
   */
  cert: fs.readFileSync(broker_cfg.certpath),
  key: fs.readFileSync(broker_cfg.keypath),
  ca: [fs.readFileSync(broker_cfg.cacertpath)],
  // SASL EXTERNAL mechanism
  credentials: credentials.external(),
};

const process_msg = (
  channel: amqp.Channel,
  msg: amqp.ConsumeMessage | null,
): void => {
  if (_.isNull(msg)) {
    log(' [x] callback with parameter: msg == null');
    return;
  }
  /** routingKey == topic */
  const { routingKey: broker_topic } = msg.fields;
  const { messageId: broker_msg_id, headers } = msg.properties;
  log(' [x] %s, %s', broker_topic, broker_msg_id);
  const unix_time = Math.floor(new Date().getTime() / 1000);
  /** Generate disctinct file-queue id. It is not related to messageID from broker. */
  const fqueue_id = `${unix_time}-${broker_msg_id}`;
  const content_str = msg.content.toString();
  try {
    var content_obj = JSON.parse(content_str);
  } catch (error) {
    log(
      ' [W] Cannot decode body, skipping message: %s, %s, %O',
      broker_msg_id,
      error,
      content_str,
    );
    channel.ack(msg);
    return;
  }
  const payload_obj: FileQueueMessage = {
    body: content_obj,
    broker_msg_id,
    broker_topic: broker_topic,
    fq_msg_id: fqueue_id,
    provider_name: listener_name,
    provider_timestamp: unix_time,
    broker_extra: { ...headers },
  };
  /** 'sent-at': '2021-07-30T13:10:14+00:00' */
  let provider_timestamp = Math.floor(Date.parse(headers!['sent-at']) / 1000);
  if (!_.isNaN(provider_timestamp)) {
    payload_obj.header_timestamp = provider_timestamp;
  }
  fq.push(fqueue, payload_obj).catch((err) =>
    console.warn('Could not store message at file-queue: %s.', err),
  );
  /**
   * Acknowledge to the broker that the message is processed on our side, and can be discarded.
   */
  channel.ack(msg);
};

const queue_status = async (
  queue: string,
  channel: amqp.Channel,
): Promise<void> => {
  /** Print out info about queue, how many queued messages, to trace missing Ack */
  const status = await channel.checkQueue(queue);
  log(
    ' [i] Queue name: %s, unprocessed messages: %s, consumers: %s',
    status.queue,
    status.messageCount,
    status.consumerCount,
  );
};

async function connect(): Promise<amqp.ChannelModel> {
  try {
    log(`Connecting to: ${broker_cfg.url}`);
    var conn = await amqp.connect(broker_cfg.url, socketOptions);
    log(`Connected.`);
  } catch (error) {
    throw new Error(
      `Whoops! Cannot create connection to AMQP server. ${error}`,
    );
  }
  return conn;
}

async function handle_signal(
  con: amqp.ChannelModel,
  signal: NodeJS.Signals,
): Promise<void> {
  /* Will immediately invalidate any unresolved operations, so it’s best to make sure you’ve
   * done everything you need to before calling this. Will be resolved once the connection,
   * and underlying socket, are closed.
   */
  log(`Received: ${signal}. Closing connection to AMQP server.`);
  /*
   * Initiate graceful closing handshake.
   */
  await con.close();
  log('Clean exit');
  process.exit(0);
}

function on_close(err?: any): void {
  /*
   * Connection close complete, rather by:
   *   * graceful close()
   *   * server-initiated shutdown
   *   * error.
   */
  log('Close connection complete.');
  if (err && isFatalError(err)) {
    // crash-worthy error
    console.warn(`Not recoverable fatal error: ${err}`);
    process.exit(1);
  }
}

function on_error(err: any): void {
  /*
   * Connection closes by reason other then graceful close().
   */
  if (isFatalError(err)) {
    log(`Connection fatal error: ${err}`);
  } else {
    log(`Connection error: ${err}`);
  }
}

async function start() {
  file_queue_path = mkDirParents(file_queue_path_cfg);
  log('File-queue path: %s', file_queue_path);
  fqueue = await fq.make(file_queue_path);
  const connection = await connect();
  const clean_on: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGABRT'];
  for (const signal of clean_on) {
    process.once(signal, _.curry(handle_signal)(connection));
  }
  connection.on('close', on_close);
  connection.on('error', on_error);
  connection.on('blocked', () =>
    console.warn('RabbitMQ server decided to block the connection.'),
  );
  connection.on('unblocked', () =>
    console.warn('RabbitMQ server decided to unblock the connection.'),
  );
  /*
   * Channel objects are something like session
   */
  try {
    var channel = await connection.createChannel();
  } catch (error) {
    throw new Error(`Whoops! Cannot create channel. ${error}`);
  }
  channel.on('close', () => log('Channel: closing-handshake has completed.'));
  channel.on('error', (err) =>
    log('Server closes the channel for reason: %s', err),
  );
  const queue_name = uuidv4(); // Server creates a queue name for us set to ''
  log('Gen queue name: %s', queue_name);
  // Not necessary step, assert that the broker has configured exchange.
  // If exchange doesn’t exist, the channel will be closed with an error.
  const exchange_is_ok = await channel.checkExchange(broker_cfg.exchange_name);
  const queue = await channel.assertQueue(queue_name, {
    /*
     * https://www.rabbitmq.com/queues.html
     */
    /*
     * false - delete the queue on broker restart
     * true (def) - the queue will survive broker restarts
     */
    durable: false,
    /*
     *  Scopes the queue to the connection
     *  false (def) - allow multiple simultaneous consumers
     *  Once the consumer connection is closed, the queue should be deleted
     *  An exclusive queue can only be used by its declaring connection.
     */
    exclusive: true,
    /*
     * true - the queue will be deleted when the number of consumers drops to zero.
     * false (def)
     * queue that has had at least one consumer is deleted when last consumer unsubscribes
     */
    autoDelete: true,
  });
  log(
    'Access to queue established: %s, messages: %s, consumers: %s',
    queue.queue,
    queue.messageCount,
    queue.consumerCount,
  );
  _.forEach(topics_cfg, (key) => {
    /*
     * Relationship between exchange and a queue is called a binding
     */
    channel.bindQueue(queue.queue, broker_cfg.exchange_name, key);
  });
  /*
   * https://www.rabbitmq.com/consumer-prefetch.html
   * Apply to consumers started after prefetch() method is called.
   * global = faslse (def), applied separately to each new consumer on the channel
   */
  log('Set prefetch to %s.', broker_cfg.prefetch);
  channel.prefetch(parseInt(broker_cfg.prefetch), false);
  /*
   * Store consumerTag if you want to cancel this consume operation
   */
  const consumerTag = await channel.consume(
    queue.queue,
    _.partial(process_msg, channel),
    {
      /*
       * broker won’t let anyone else consume from this queue
       */
      exclusive: true,
      /*
       * acknowledge that we received each message
       */
      noAck: false,
    },
  );
  const status_task = cron.schedule(
    /** running a task every minute */
    '* * * * *',
    _.partial(queue_status, queue.queue, channel),
  );
  log(' [*] Waiting for messages. To exit press CTRL+C');
}

start().catch((error) => {
  console.warn(error);
  process.exit(1);
});
