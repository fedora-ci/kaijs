/*
 * This file is part of kaijs

 * Copyright (c) 2023 Andrei Stepanov <astepano@redhat.com>
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
import assert from 'assert';
import { Client, ClientOptions } from '@opensearch-project/opensearch';

import { getcfg } from '../cfg';
import { FileQueueMessage } from '../fqueue';
import { AJVValidationError } from '../validation_ajv';
import { WrongVersionError } from '../validation_broker';
import { assertMsgIsValid, NoValidationSchemaError } from '../validation';
import {
  getHandler,
  NoNeedToProcessError,
  NoAssociatedHandlerError,
} from './msg_handlers';

const log = debug('kaijs:opensearch');
const cfg = getcfg();

export type ArtifactContext = 'redhat' | 'centos' | 'fedora' | 'any';

/**
 * Expect that indexes are present and configured, for example with templates.
 */
export const getIndexName = (
  artifactConext: ArtifactContext,
  artifactType: ArtifactTypes | 'invalid-messages',
) => {
  let indexName = '';
  if (artifactConext === 'redhat') {
    if (artifactType === 'brew-build') {
      indexName = 'redhat-rpm';
    } else if (artifactType === 'koji-build') {
      indexName = 'fedora-rpm';
    } else if (artifactType === 'productmd-compose') {
      indexName = 'redhat-compose';
    } else if (artifactType === 'redhat-module') {
      indexName = 'redhat-module';
    }
  } else if (artifactConext === 'centos') {
    if (artifactType === 'koji-build-cs') {
      indexName = 'centos-rpm';
    }
  } else if (artifactConext === 'fedora') {
    if (artifactType === 'koji-build') {
      indexName = 'fedora-rpm';
    } else if (artifactType === 'fedora-module') {
      indexName = 'redhat-module';
    }
  } else if (artifactConext === 'any') {
    if (artifactType === 'invalid-messages') {
      indexName = 'invalid-messages';
    }
  }
  if (!indexName) {
    throw `Cannot get index name for artifact type: ${artifactType} and context: ${artifactConext}`;
  }
  const prefix = cfg.loader.opensearch.indexes_prefix;
  return `${prefix}${indexName}`;
};

export interface Upsert {
  docId: string;
  indexName: string;
  upsertDoc: Document | ValidationErrorsDocument;
  routing?: string;
}

export interface Document {
  /** Document based on a message from messages-broker */
  message?: MessageData;
  /** Contains searchable entries */
  searchable?: TSearchable;
  '@timestamp'?: number;
  /** Used for parent-child mapping */
  artifact_message: unknown;
}

export interface MessageDataExtracted {
  /** Version of schema broker message complays to. */
  version?: string;
  thread_id?: string;
  test_case_name?: string;
}

export interface MessageData {
  /** Broker topic */
  broker_msg_topic: string;
  /** Broker message id */
  broker_msg_id: string;
  /**
   * JSON document for message
   */
  broker_msg_body: any;
  /**
   * Message headers.
   */
  broker_extra?: any;
}

/**
 * All documents are uniquelly identified by
 *
 * Parents:
 *
 * * artifact-type : string
 * * artifact-id : string
 *
 * Children:
 *
 * * message-id
 *
 * List here all possible artifact-types:
 *
 * https://pagure.io/greenwave/blob/master/f/conf/subject_types
 * https://gitlab.cee.redhat.com/gating/greenwave-playbooks/-/blob/master/roles/greenwave/files/subject_types.yaml
 */

export type ArtifactTypes =
  /**
   * Builds from https://koji.fedoraproject.org/
   */
  | 'koji-build'
  /**
   * Builds from https://copr.fedorainfracloud.org/
   */
  | 'copr-build'
  /**
   * Builds from https://brewweb.engineering.redhat.com/
   */
  | 'brew-build'
  /**
   * PR from https://src.osci.redhat.com/
   */
  | 'dist-git-pr'
  /**
   * MBS builds from https://mbs.engineering.redhat.com/
   */
  | 'redhat-module'
  | 'fedora-module'
  /**
   * Composes produced by http://odcs.engineering.redhat.com/
   */
  | 'productmd-compose'
  /**
   * Builds from https://kojihub.stream.centos.org/koji/
   */
  | 'koji-build-cs'
  /*
   * Containers produced by https://brewweb.engineering.redhat.com/
   */
  | 'redhat-container-image';

/**
 * RPM -> Build -> TaskId ->
 *                        -> TaskId
 *                        -> TaskId
 *                        -> TaskId
 */
export interface SearchableRpm {
  /** task id */
  task_id: string;
  /** 0ad-0.0.23b-13.fc33 */
  nvr: string;
  /** owner of the build */
  issuer: string;
  /** name from nvr */
  component: string;
  /**
   * git://pkgs.devel.redhat.com/rpms/navilu-fonts?#937e7b088e82736a62d0b21cbb0f2e1299400b2e
   */
  source: string;
  build_id: string;
  /**
   * Gating tag. Example: rhel-8.1.0-gate
   */
  gate_tag_name?: string;
  broker_msg_id_brew_tag?: string;
}

/**
 * Scratch has only taskId
 */
export interface SearchableScratch {
  /** task id */
  task_id: string;
  /** 0ad-0.0.23b-13.fc33 */
  nvr: string;
  /** owner of the build */
  issuer: string;
  /** name from nvr */
  component: string;
  /**
   * git://pkgs.devel.redhat.com/rpms/navilu-fonts?#937e7b088e82736a62d0b21cbb0f2e1299400b2e
   */
  source: string;
  /** Broker message id */
  broker_msg_id: string;
}

export interface SearchableContainerImage {
  /*
   * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-container-image.yaml
   */
  /** task id */
  task_id: number;
  /** mirror-registry-container-v1.2.8-3 */
  nvr: string;
  /** owner of the build */
  issuer: string;
  /** name from nvr */
  component: string;
  /** true or false or */
  scratch: boolean;
  /**
   * git://pkgs.devel.redhat.com/rpms/navilu-fonts?#937e7b088e82736a62d0b21cbb0f2e1299400b2e
   */
  source?: string;
  /*
   * Brew build ID of container
   */
  build_id?: number;
  /*
   * A digest that uniquely identifies the image within a repository.
   * Example: sha256:67dad89757a55bfdfabec8abd0e22f8c7c12a1856514726470228063ed86593b
   */
  id: string;
  name?: string;
  namespace?: string;
  full_names: string[];
  registry_url?: string;
  tag?: string;
  /*
   * Entries come from: VirtualTopic.eng.brew.build.complete
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.complete&delta=86400&contains=container_build
   */
  osbs_subtypes?: string[];
  broker_msg_id_build_complete?: string;
}

export interface SearchableRedHatModule {
  nvr: string;
  nsvc: string;
  name: string;
  mbs_id: string;
  issuer: string;
  stream: string;
  version: string;
  context: string;
  source?: string;
  scratch?: boolean;
  gate_tag_name?: string;
  broker_msg_id_brew_tag?: string;
}

export interface SearchableKojiBuild
  extends Omit<SearchableRpm, 'gate_tag_name'> {}

export interface SearchableFedoraModule
  extends Omit<SearchableRpm, 'gate_tag_name'> {}

export interface SearchableDistGitPR {
  uid: string;
  issuer: string;
  repository: string;
  comment_id: string;
  commit_hash: string;
}

export interface SearchableCompose {
  compose_id: string;
  /** nightly */
  compose_type: string;
  release_type?: string;
}

export interface ValidationErrorsDocument {
  /** timestamp */
  '@timestamp': string;
  /** Error message */
  errmsg: Joi.ValidationErrorItem[] | string;
  /** Message from broker */
  broker_msg: any;
  /** Broker topic */
  broker_topic: string;
  /** Broker message id */
  broker_msg_id: string;
}

export type TSearchable =
  | SearchableRpm
  | SearchableEta
  | SearchableTest
  | SearchableCompose
  | SearchableKojiBuild
  | SearchableDistGitPR
  | SearchableRedHatModule
  | SearchableFedoraModule
  | SearchableContainerImage;

export interface SearchableEta {
  nvr: string;
  type: string;
  owner: string;
  task_id: string;
  component: string;
  ci_run_url: string;
  broker_topic: string;
  msg_timestamp: number;
  broker_msg_id: string;
  ci_run_outcome: string;
  ci_run_explanation: string;
}

export interface SearchableTest {
  task_id: string;
  /** Required. Example: copr-build */
  type: string;
  /**
   * thread_id is copied thread_id from message or generated by KAI.
   */
  thread_id: string;
  /** Broker message id */
  broker_msg_id: string;
  /** Broker topic */
  broker_topic: string;
  /**
   * Create, if possible, test case name.
   * The same name will have resultsdb:
   * https://pagure.io/fedora-ci/messages/blob/master/f/mappings/results/brew-build.test.complete.yaml#_5
   *
   *    name: "${body.test.namespace}.${body.test.type}.${body.test.category}"
   *
   * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/test-common.yaml#_52
   *
   */
  test_case_name?: string;
  /**
   * stage can be: 'build', 'dispatch', 'test', 'promote', etc....
   * derived from topic
   * stage (in standard called as `event`) is always the second item from the end of the topic
   * Examples:
   *
   * * pull-request.test.error -> test
   * * brew-build.promote.error -> promote
   **/
  test_stage: string;
  /**
   * state is always the latest part of the message
   * Examples:
   *
   *  * brew-build.promote.error -> error
   *  * brew-build.test.complete -> complete
   */
  test_state: string;
  scratch?: boolean;
  /** 0ad-0.0.23b-13.fc33 */
  nvr: string;
  /**
   * git://pkgs.devel.redhat.com/rpms/navilu-fonts?#937e7b088e82736a62d0b21cbb0f2e1299400b2e
   */
  source: string;
  /** owner of the build */
  issuer: string;
  /** name from nvr */
  component: string;
  msg_timestamp: number;
}

export class OpensearchDocumentError extends Error {
  constructor(m: string) {
    super(m);
    /**
     * Set the prototype explicitly.
     */
    Object.setPrototypeOf(this, OpensearchDocumentError.prototype);
  }
}

export const printify = (obj: any): string => {
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
};

const mkInvalidMsgUpsert = (
  fqMsg: FileQueueMessage,
  err:
    | WrongVersionError
    | AJVValidationError
    | Joi.ValidationError
    | NoValidationSchemaError
    | NoAssociatedHandlerError,
): Upsert => {
  let broker_msg = printify(fqMsg.body);
  const size: number = Buffer.byteLength(broker_msg, 'utf8');
  if (size > 17800000) {
    broker_msg = 'Message is bigger then 16Mb. Cannot store.';
  }
  const upsertDoc: ValidationErrorsDocument = {
    '@timestamp': new Date().toISOString(),
    broker_msg,
    errmsg: err instanceof Joi.ValidationError ? err.details : err.message,
    broker_topic: fqMsg.broker_topic,
    broker_msg_id: fqMsg.broker_msg_id,
  };
  const docId = fqMsg.broker_msg_id;
  const indexName = getIndexName('any', 'invalid-messages');
  const upsert: Upsert = {
    docId,
    indexName,
    upsertDoc,
  };
  return upsert;
};

export const getMsgUpserts = async (
  fqMsg: FileQueueMessage,
): Promise<Upsert[]> => {
  const { broker_topic, broker_msg_id } = fqMsg;
  /**
   * Verify for correctness of input message with associated schema.
   */
  let upserts: Upsert[] = [];
  try {
    await assertMsgIsValid(fqMsg);
    const handler = getHandler(broker_topic);
    log(" [I] '%s', %s", broker_topic, broker_msg_id);
    if (_.isUndefined(handler)) {
      const metric_name = 'handler-' + broker_topic;
      log(' [E] No handler for topic: %s', broker_topic);
      const errmsg = `broker msg-id: ${broker_msg_id}: does not have associated handler for topic '${broker_topic}'.`;
      throw new NoAssociatedHandlerError(errmsg, broker_topic);
    }
    upserts = await handler(fqMsg);
  } catch (err) {
    if (
      err instanceof WrongVersionError ||
      err instanceof AJVValidationError ||
      err instanceof Joi.ValidationError ||
      err instanceof NoValidationSchemaError ||
      err instanceof NoAssociatedHandlerError
    ) {
      log(
        ' [E] Validation error. Store message to special index. Message with broker msg-id: %s and file-queue message-id: %s.\nValidation error: %s.\n',
        fqMsg.broker_msg_id,
        fqMsg.fq_msg_id,
        err.message,
      );
      const upsert: Upsert = mkInvalidMsgUpsert(fqMsg, err);
      upserts = [upsert];
    } else if (err instanceof NoNeedToProcessError) {
      /**
       * Do nothing with message
       */
      log(
        ' [i] Drop message as requested. Message with broker msg-id: %s and file-queue message-id: %s.\nReason: %s.\n',
        fqMsg.broker_msg_id,
        fqMsg.fq_msg_id,
        err.message,
      );
    }
  }
  return upserts;
};

export class OpensearchClient {
  public client?: Client;
  private clientOptions: ClientOptions;

  constructor() {
    const config = cfg.loader.opensearch;
    this.clientOptions = config.client;
    this.client = new Client(this.clientOptions);
  }

  log(s: string, ...args: any[]): void {
    const msg = ` [I] ${s}`;
    log(msg, ...args);
  }

  fail(s: string, ...args: any[]): void {
    const msg = ` [E] ${s}`;
    log(msg, ...args);
  }

  async init(): Promise<void> {
    try {
      assert.ok(this.client, 'Opensearch client is empty.');
    } catch (err) {
      await this.client?.close();
      throw err;
    }
  }

  async bulkUpdate(upserts: Upsert[]): Promise<void> {
    if (_.isUndefined(this.client)) {
      throw new Error('Connection is not initialized');
    }
    log(' [I] Send bulk with %s upsert(s).', upserts.length);
    try {
      const body = _.flatMap(upserts, (upsert) => [
        {
          update: {
            _index: upsert.indexName,
            _id: upsert.docId,
            routing: upsert.routing,
          },
        },
        { doc: upsert.upsertDoc, doc_as_upsert: true },
      ]);
      const { body: response } = await this.client.bulk({ body });
      if (response.errors !== false) {
        /** Use printify() to get errors meaning. */
        log(' [E] Result of bulk action: %O', printify(response));
        throw new Error('Error in bulk operation.');
      }
      log(' [I] bulk operation is successfull.');
    } catch (err) {
      this.fail('Bulk update failed.');
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
  }
}
