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

import _ from 'lodash';
import Joi from 'joi';
import debug from 'debug';
import {
  Db,
  Collection,
  MongoError,
  MongoClient,
  MongoClientOptions,
} from 'mongodb';
import assert from 'assert';

import { getcfg } from './cfg';
import {
  drop_empty_paths,
  path_mongodb_to_lodash,
  paths_mongodb_pack_array,
} from './paths';
import { metrics_up_broker } from './metrics';
import {
  ArtifactModel,
  RawMessagesModel,
  ValidationErrorsModel,
} from './db_interface';
import { getHandler, NoAssociatedHandlerError } from './msg_handlers';
import {
  assertMsgIsValid,
  assert_is_valid,
  NoValidationSchemaError,
} from './validation';
import { WrongVersionError } from './validation_broker';
import { FileQueueMessage } from './fqueue';
import { AJVValidationError } from './validation_ajv';

export class ToLargeDocumentError extends Error {
  constructor(m: string) {
    super(m);
    /**
     * Set the prototype explicitly.
     */
    Object.setPrototypeOf(this, ToLargeDocumentError.prototype);
  }
}

const log = debug('kaijs:db');
const cfg = getcfg();

function on_close(err: MongoError): void {
  console.warn(`db socket closed: ${err}`);
  process.exit(1);
}

function on_error(err: MongoError): void {
  console.warn(`db error occurred: ${err}`);
  process.exit(1);
}

function on_timeout(err: MongoError): void {
  console.warn(`socket timeout occurred: ${err}`);
  process.exit(1);
}

function on_parseError(err: MongoError): void {
  console.warn(
    `db driver detects illegal or corrupt BSON being received from the server: ${err}`,
  );
  process.exit(1);
}

function on_reconnect(obj: any): void {
  console.warn(`driver has reconnected and re-authenticated`);
}

class DBCollection {
  private cfg_entry: keyof typeof cfg.loader.db.collections;
  public collection_name: string;
  public url: string;
  /** Use the same DB instance. Any consequential db-open will return the same instance. */
  public db?: Db;
  public collection?: Collection<any>;
  /** Mongo client -> client-server connection -> db instance 1, db instance 2, ... */
  public mongo_client: MongoClient;
  public db_name?: string;
  public options?: MongoClientOptions;
  public static def_options = {
    useUnifiedTopology: true,
  };

  constructor(
    cfg_entry: keyof typeof cfg.loader.db.collections,
    url?: string,
    collection_name?: string,
    db_name?: string,
    options?: MongoClientOptions,
  ) {
    this.cfg_entry = cfg_entry;
    this.url = url || cfg.loader.db.db_url;
    this.collection_name =
      collection_name || cfg.loader.db.collections[this.cfg_entry].name;
    this.db_name = db_name || cfg.loader.db.db_name;
    /** http://mongodb.github.io/node-mongodb-native/3.6/api/MongoClient.html */
    const opts = options || _.cloneDeep(DBCollection.def_options);
    _.merge(opts, options);
    this.mongo_client = new MongoClient(this.url, opts);
  }

  log(s: string, ...args: any[]): void {
    const msg = ` [i] ${this.collection_name} ${s}`;
    log(msg, ...args);
  }

  fail(s: string, ...args: any[]): void {
    const msg = ` [E] ${this.collection_name} ${s}`;
    log(msg, ...args);
  }

  async init(): Promise<void> {
    try {
      await this.mongo_client.connect();
      /** If db name is not provided, use database name from connection string. */
      this.db = this.mongo_client.db(this.db_name);
      /** verify connection */
      this.db.command({ ping: 1 });
      const collections = await this.db.listCollections().toArray();
      const collectionNames = collections.map((c) => c.name);
      if (!collectionNames.includes(this.collection_name)) {
        await this.db.createCollection(this.collection_name);
      }
      this.collection = this.db.collection<ValidationErrorsModel>(
        this.collection_name,
      );
      this.log('Connected successfully to collection.');
      /** Db is no longer the place to listen to events, you should listen to your MongoClient. */
      this.db.on('close', on_close);
      this.db.on('error', on_error);
      this.db.on('error', on_timeout);
      this.db.on('reconnect', on_reconnect);
      this.db.on('parseError', on_parseError);
    } catch (err) {
      this.mongo_client.close();
      throw err;
    }
  }

  async cfg_indexes(): Promise<void> {
    this.log('Configure indexes.');
    const indexes_config = cfg.loader.db.collections[this.cfg_entry].indexes;
    const indexes_active = await this.collection?.indexes();
    this.log('Active indexes: %o', indexes_active);
    this.log('Indexes in configuration: %o', indexes_config);
    const preserve = ['_id_'];
    /** Drop indexes that are absent in configuration */
    const keep = preserve.concat(
      _.map(
        indexes_config,
        _.flow(_.identity, _.partialRight(_.get, 'options.name')),
      ),
    );
    if (_.size(indexes_active)) {
      for (const index of indexes_active) {
        if (keep.includes(index.name)) {
          this.log('Keep index: %s', index.name);
          continue;
        }
        this.log('Drop index: %s', index.name);
        await this.collection?.dropIndex(index.name);
      }
    }
    if (!_.size(indexes_config)) {
      this.log('No configuration for indexes.');
      return;
    }
    for (const index of indexes_config) {
      const name = _.get(index, 'options.name');
      const is_present =
        _.findIndex(
          indexes_active,
          _.flow(
            _.identity,
            _.partialRight(_.get, 'name'),
            _.partialRight(_.isEqual, name),
          ),
        ) >= 0;
      if (is_present) {
        this.log('Index is already present: %s', name);
        continue;
      }
      this.log('Add index: %s', name);
      await this.collection?.createIndex(index.keys, index.options);
    }
  }

  async close(): Promise<void> {
    try {
      await this.mongo_client.close();
    } catch (err) {
      this.fail('Cannot close connection to DB.');
      throw err;
    }
  }

  printify(obj: any): string {
    var cache: any[] = [];
    function circular_ok(key: string, value: any) {
      if (typeof value === 'object' && value !== null) {
        if (cache.indexOf(value) !== -1) {
          return;
        }
        cache.push(value);
      }
      return value;
    }
    return JSON.stringify(obj, circular_ok, 2);
  }
}

/**
 * https://stackoverflow.com/questions/35055731/how-to-deeply-map-object-keys-with-javascript-lodash
 */
export type TKeyChangerFunction = (value: any, key: string) => string;
export const deepMapKeys = function (obj: any, fn: TKeyChangerFunction) {
  var x: { [key: string]: any } = {};
  _.forOwn(obj, function (v, k) {
    if (_.isObjectLike(v)) v = deepMapKeys(v, fn);
    x[fn(v, k)] = v;
  });
  return x;
};

/**
 * Operates on mongodb collection
 */
export class ValidationErrors extends DBCollection {
  constructor(
    url?: string,
    collection_name?: string,
    db_name?: string,
    options?: MongoClientOptions,
  ) {
    super('invalid', collection_name, url, db_name, options);
  }

  async add_to_db(
    fq_msg: FileQueueMessage,
    err:
      | Joi.ValidationError
      | WrongVersionError
      | NoValidationSchemaError
      | NoAssociatedHandlerError
      | AJVValidationError,
  ): Promise<void> {
    const expire_at = new Date();
    var keep_days = 15;
    expire_at.setDate(expire_at.getDate() + keep_days);
    let broker_msg = this.printify(fq_msg.body);
    const size: number = Buffer.byteLength(broker_msg, 'utf8');
    if (size > 17800000) {
      broker_msg = 'Message is bigger then 16Mb. Cannot store.';
    }
    const document: ValidationErrorsModel = {
      _added: new Date().toISOString(),
      broker_msg,
      errmsg: err instanceof Joi.ValidationError ? err.details : err.message,
      expire_at,
      broker_topic: fq_msg.broker_topic,
      broker_msg_id: fq_msg.broker_msg_id,
    };
    try {
      await this.collection?.insertOne(document);
      this.log('Stored invalid object');
    } catch (err) {
      this.fail('Cannot store invalid object.');
      throw err;
    }
  }
}

/**
 * Operates on mongodb collection
 */
export class RawMessages extends DBCollection {
  constructor(
    url?: string,
    collection_name?: string,
    db_name?: string,
    options?: MongoClientOptions,
  ) {
    super('raw_messages', collection_name, url, db_name, options);
  }

  async findOrCreate(document: RawMessagesModel): Promise<void> {
    if (_.isUndefined(this.collection)) {
      throw new Error('Connection is not initialized');
    }
    /** http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#findOneAndUpdate */
    this.log(
      'Store mongodb document for msgID %s if absent',
      document.broker_msg_id,
    );
    var added = new Date().toISOString();
    const { broker_msg_id } = document;
    try {
      await this.collection.findOneAndUpdate(
        /** query / filter */
        { broker_msg_id },
        /** update */
        {
          $setOnInsert: { ...document, _added: added },
        },
        /** options */
        {
          /** insert the document if it does not exist */
          upsert: true,
        },
      );
    } catch (err) {
      /**
       * Can throw an exception when user does not have RO permissions
       */
      this.fail('findOrCreate() failed for message: %s:', broker_msg_id);
      throw err;
    }
  }

  async add_to_db(fq_msg: FileQueueMessage): Promise<void> {
    const expire_at = new Date();
    var keep_days = 15;
    expire_at.setDate(expire_at.getDate() + keep_days);
    let broker_msg = this.printify(fq_msg.body);
    const size: number = Buffer.byteLength(broker_msg, 'utf8');
    if (size > 17800000) {
      broker_msg = 'Message is bigger then 16Mb. Cannot store.';
    }
    const document: RawMessagesModel = {
      _added: new Date().toISOString(),
      broker_msg,
      broker_topic: fq_msg.broker_topic,
      broker_msg_id: fq_msg.broker_msg_id,
      broker_extra: fq_msg.broker_extra,
    };
    try {
      await this.findOrCreate(document);
    } catch (err) {
      this.fail('Cannot store broker message %s.', document.broker_msg_id);
      throw err;
    }
  }
}

/**
 * Operates on mongodb collection
 */
export class Artifacts extends DBCollection {
  constructor(
    url?: string,
    collection_name?: string,
    db_name?: string,
    options?: MongoClientOptions,
  ) {
    super('artifacts', collection_name, url, db_name, options);
  }

  async findOrCreate(type: string, aid: string): Promise<ArtifactModel> {
    if (_.isUndefined(this.collection)) {
      throw new Error('Connection is not initialized');
    }
    /** http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#findOneAndUpdate */
    var result;
    this.log('Getting mongodb document for type: %s and aid: %s', type, aid);
    var updated = new Date().toISOString();
    try {
      result = await this.collection.findOneAndUpdate(
        /** query / filter */
        { type, aid },
        /** update */
        {
          $setOnInsert: { type, aid, _version: 1, _updated: updated },
        },
        /** options */
        {
          /** false == returns the updated document rather than the original */
          returnOriginal: false,
          /** insert the document if it does not exist */
          upsert: true,
          /** Indexes created with collation */
          collation: { locale: 'simple', numericOrdering: true },
        },
      );
    } catch (err) {
      /**
       * Can throw an exception when user does not have RO permissions
       */
      this.fail('findOrCreate() failed for type: %s, aid: %s', type, aid);
      throw err;
    }
    const { value: document, lastErrorObject, ok } = result;
    /**
     * On success:
     *
     * lastErrorObject: { n: 1, updatedExisting: false, upserted: 608152d136ffcb6b327711a1 }
     * ok: 1
     */
    assert_is_valid(document, 'db_artifact');
    return document as ArtifactModel;
  }

  /**
   * * Always rewrite old arrays or new arrays values
   * * Does not update scalar values with new values
   * * Does not remove old scalar values
   */
  mk_update_set(present: ArtifactModel, newdata: ArtifactModel) {
    const paths_new = paths_mongodb_pack_array(newdata);
    const paths_present = paths_mongodb_pack_array(present);
    /**
     * Drop path that resolve to isNull or isUndefined
     */
    drop_empty_paths(paths_new, newdata);
    drop_empty_paths(paths_present, present);
    /**
     * Get paths:
     *
     *  * present in newdata, but absent in present
     * 	or
     *  * always takes path from newdata that resolves to array
     */
    const paths_update = _.differenceWith(
      paths_new,
      paths_present,
      /**
       * when to drop path
       */
      (new_path, old_path) => {
        if (new_path !== old_path) {
          /* keep path, drop only if old path == new path, and values are different */
          return false;
        }
        const new_path_lodash = path_mongodb_to_lodash(new_path);
        const old_path_lodash = path_mongodb_to_lodash(old_path);
        const new_value = _.get(newdata, new_path_lodash);
        const old_value = _.get(present, old_path_lodash);
        const drop = _.isEqual(new_value, old_value);
        return drop;
      },
    );
    const pairs = _.map(
      paths_update,
      _.unary(_.over(_.identity, _.partial(_.get, newdata))),
    );
    const updateSet = _.fromPairs(pairs);
    return updateSet;
  }

  /**
   * @param artifact - holds data, necessary add to DB.
   * @returns updated document
   */
  async add(message: FileQueueMessage): Promise<ArtifactModel> {
    const { broker_topic, broker_msg_id } = message;
    if (_.isUndefined(this.collection)) {
      throw new Error('Connection is not initialized');
    }
    const handler = getHandler(broker_topic);
    this.log("'%s', %s", broker_topic, broker_msg_id);
    if (_.isUndefined(handler)) {
      const metric_name = 'handler-' + broker_topic;
      metrics_up_broker(metric_name, 'nack');
      log(' [E] No handler for topic: %s', broker_topic);
      const errmsg = `broker msg-id: ${broker_msg_id}: does not have associated handler for topic '${broker_topic}'.`;
      throw new NoAssociatedHandlerError(errmsg, broker_topic);
    }
    /** Retry update artifact entry in db */
    let retries_left = 30;
    var artifact: any;
    let modifiedDocument = null;
    const options = {
      returnOriginal: false,
      collation: { locale: 'simple', numericOrdering: true },
    };
    while (_.isNull(modifiedDocument) && retries_left > 1) {
      retries_left -= 1;
      if (retries_left === 0) {
        break;
      }
      /**
       * handler().message.id:
       *
       *   1) Finds or creates a new mongodb-document for pair: type + aid
       *   2) Returns updated object with updated values
       *
       */
      artifact = await handler(this, message);
      /**
       * Check if new document is valid before it update
       */
      assert_is_valid(artifact, 'db_artifact');
      const { type, aid } = artifact;
      var db_entry;
      try {
        db_entry = await this.findOrCreate(type, aid);
      } catch (err) {
        /**
         * try again
         */
        continue;
      }
      const update_set = this.mk_update_set(db_entry, artifact);
      if (_.isEmpty(update_set)) {
        this.log(
          'Update set is empty for type: %s aid: %s. Do not update document.',
          type,
          aid,
        );
        return artifact;
      }
      const filter = _.pick(db_entry, '_id', '_version');
      update_set._updated = new Date().toISOString();
      const updateDoc = {
        $inc: { _version: 1 },
        $set: update_set,
      };
      /**
       * Return null if no document was not updated
       * Concurrency protected
       * https://docs.particular.net/persistence/mongodb/document-version
       */
      try {
        /**
         * lastErrorObject - status of last operation
         * https://docs.mongodb.com/manual/reference/command/findAndModify/#output
         */
        const {
          ok,
          value,
          /** Contains information about updated documents.  */
          lastErrorObject,
        } = await this.collection.findOneAndUpdate(filter, updateDoc, options);
        /** Contains the command's execution status. 1 on success, or 0 if an error occurred. */
        assert.ok(ok === 1, 'Cannot update artifact document with new values.');
        /** Contains true if an update operation modified an existing document. */
        assert.ok(
          lastErrorObject.updatedExisting === true,
          'Error to upate existing artifact document with new values',
        );
        modifiedDocument = value;
      } catch (err) {
        /**
         * Can throw an exception when user does not have RO permissions
         */
        if (
          err instanceof RangeError &&
          _.get(err, 'code') === 'ERR_OUT_OF_RANGE'
        ) {
          const errMsg = `Resulted MongoDB document exceed allowed document. For message-id: ${broker_msg_id} and broker-topic: ${broker_topic}`;
          throw new ToLargeDocumentError(errMsg);
        }
        if (_.isError(err)) {
          this.fail(
            'Cannot update db. Retries left: %s:%s%s',
            retries_left,
            '\n',
            err.message,
          );
        } else {
          throw err;
        }
      }
      if (modifiedDocument) {
        return modifiedDocument as ArtifactModel;
      }
    }
    throw new Error(
      `Cannot set missing fields for type: ${artifact.type} and aid: ${artifact.aid}. All attempts failed.`,
    );
  }

  async add_to_db(message: FileQueueMessage): Promise<void> {
    const { broker_topic, broker_msg_id } = message;
    /**
     * Verify for correctness of input message with associated schema.
     */
    await assertMsgIsValid(message);
    /**
     * Invoke associated handler for the message
     */
    try {
      /**
       * add(): writes updated object to DB
       */
      await this.add(message);
    } catch (err) {
      throw err;
    }
  }
}

export async function get_collection(
  name: keyof typeof cfg.loader.db.collections,
  url?: string,
  collection_name?: string,
  db_name?: string,
  options?: MongoClientOptions,
): Promise<Artifacts | ValidationErrors | RawMessages> {
  var Class;
  if (name === 'artifacts') {
    Class = Artifacts;
  } else if (name === 'invalid') {
    Class = ValidationErrors;
  } else if (name === 'raw_messages') {
    Class = RawMessages;
  } else {
    throw new Error('Unknown collection name.');
  }
  const collection = new Class(url, collection_name, db_name, options);
  await collection.init();
  await collection.cfg_indexes();
  return collection;
}
