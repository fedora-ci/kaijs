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

/**
 * Create a db-entry with schema: schema_db_artifact
 * Extract only required fields.
 * Store unmodified message at 'db_artifact.states[]'.
 * msg - passed schema_rpm_build_test_complete schema
 *
 * Example:
 *
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.complete&delta=127800
 *
 * Topics:
 *
 * * org.centos.prod.ci.koji-build.test.complete
 * * VirtualTopic.eng.ci.brew-build.test.complete
 * * VirtualTopic.eng.ci.*.brew-build.test.complete
 *
 * Supported versions: https://pagure.io/fedora-ci/messages/releases
 *
 * * 0.2.1
 *
 * This is not RPM build. This is Koji/Brew build, which could be also container build.
 *
 * https://brewweb.engineering.redhat.com/brew/api
 * https://koji.fedoraproject.org/koji/api
 *
 */

import _, { update } from 'lodash';
import debug from 'debug';
import {
  Update,
  Document,
  getIndexName,
  SearchableMbs,
  SearchableRpm,
  ArtifactContext,
  SearchableTestRpm,
  SearchableCompose,
  SearchableTestCompose,
  SearchableContainerImage,
  SearchableTestContainerImage,
  SearchableTestMbs,
} from './opensearch';
import {
  THandler,
  mkThreadId,
  isTestStage,
  THandlersSet,
  mkSearchable,
  TGetSearchable,
  makeMessageData,
  makeTestCaseName,
  TSearchableHandlersSet,
  messageToString,
} from './msg_handlers';
import { FileQueueMessage } from '../fqueue';
import { assert_is_valid } from '../validation';

const log = debug('kaijs:msg_handlers_test');

/**
 * V1 - Schema for messages with version >= 1.0.0
 */
const mkSearchableRpmTestV1 = (fq_msg: FileQueueMessage): SearchableTestRpm => {
  const { broker_topic, body, broker_msg_id } = fq_msg;
  const { artifact } = body;
  var thread_id = mkThreadId(fq_msg);
  var test_state = _.last(_.split(broker_topic, '.')) as string;
  var test_stage = _.nth(_.split(broker_topic, '.'), -2) as string;
  let test_case_name;
  if (isTestStage(broker_topic)) {
    test_case_name = makeTestCaseName(body);
  }
  const searchable: SearchableTestRpm = {
    task_id: _.toString(_.get(artifact, 'id')),
    type: _.get(artifact, 'type'),
    nvr: _.get(artifact, 'nvr'),
    source: _.get(artifact, 'source'),
    issuer: _.get(artifact, 'issuer'),
    scratch: _.get(artifact, 'scratch'),
    component: _.get(artifact, 'component'),
    thread_id,
    /** state: complete, running */
    test_state,
    /** stage: build, test */
    test_stage,
    test_case_name,
    broker_msg_id,
    broker_topic,
  };
  return searchable;
};

/**
 * V1 - Schema for messages with version >= 1.0.0
 */
const mkSearchableRpmTestParentV1 = (
  fq_msg: FileQueueMessage,
): SearchableRpm => {
  const { body } = fq_msg;
  const { artifact } = body;
  const searchable: SearchableRpm = {
    task_id: _.toString(_.get(artifact, 'id')),
    nvr: _.get(artifact, 'nvr'),
    type: _.get(artifact, 'type'),
    source: _.get(artifact, 'source'),
    issuer: _.get(artifact, 'issuer'),
    scratch: _.get(artifact, 'scratch'),
    component: _.get(artifact, 'component'),
  };
  return searchable;
};

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/module-build.yaml
 */
const mkSearchableMbsTestV1 = (fq_msg: FileQueueMessage): SearchableTestMbs => {
  const { broker_topic, body, broker_extra, broker_msg_id } = fq_msg;
  const { artifact } = body;
  var thread_id = mkThreadId(fq_msg);
  var test_state = _.last(_.split(broker_topic, '.')) as string;
  var test_stage = _.nth(_.split(broker_topic, '.'), -2) as string;
  let test_case_name;
  if (isTestStage(broker_topic)) {
    test_case_name = makeTestCaseName(body);
  }
  const searchable: SearchableTestMbs = {
    nvr: _.get(artifact, 'nvr'),
    type: _.get(artifact, 'type'),
    nsvc: _.get(artifact, 'nsvc'),
    name: _.get(artifact, 'name'),
    mbs_id: _.get(artifact, 'id'),
    issuer: _.get(artifact, 'issuer'),
    stream: _.get(artifact, 'stream'),
    version: _.get(artifact, 'version'),
    context: _.get(artifact, 'context'),
    thread_id,
    /** state: complete, running */
    test_state,
    /** stage: build, test */
    test_stage,
    broker_topic,
    broker_msg_id,
    test_case_name,
  };
  return searchable;
};

const mkSearchableMbsTestParentV1 = (
  fq_msg: FileQueueMessage,
): SearchableMbs => {
  const { body } = fq_msg;
  const { artifact } = body;
  const searchable: SearchableMbs = {
    nvr: _.get(artifact, 'nvr'),
    nsvc: _.get(artifact, 'nsvc'),
    name: _.get(artifact, 'name'),
    type: _.get(artifact, 'type'),
    mbs_id: _.get(artifact, 'id'),
    issuer: _.get(artifact, 'issuer'),
    stream: _.get(artifact, 'stream'),
    version: _.get(artifact, 'version'),
    context: _.get(artifact, 'context'),
  };
  return searchable;
};

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.yaml
 */
const mkSearchableComposeTestV1 = (
  fq_msg: FileQueueMessage,
): SearchableTestCompose => {
  const { broker_topic, body, broker_extra, broker_msg_id } = fq_msg;
  const { artifact } = body;
  var thread_id = mkThreadId(fq_msg);
  var test_state = _.last(_.split(broker_topic, '.')) as string;
  var test_stage = _.nth(_.split(broker_topic, '.'), -2) as string;
  let test_case_name;
  if (isTestStage(broker_topic)) {
    test_case_name = makeTestCaseName(body);
  }
  const searchable: SearchableTestCompose = {
    type: _.get(artifact, 'type'),
    compose_id: _.get(artifact, 'id'),
    compose_type: _.get(artifact, 'compose_type'),
    release_type: _.get(artifact, 'release_type'),
    thread_id,
    /** state: complete, running */
    test_state,
    /** stage: build, test */
    test_stage,
    broker_topic,
    broker_msg_id,
    test_case_name,
  };
  return searchable;
};

const mkSearchableComposeTestParentV1 = (
  fq_msg: FileQueueMessage,
): SearchableCompose => {
  const { body } = fq_msg;
  const { artifact } = body;
  const searchable: SearchableCompose = {
    type: _.get(artifact, 'type'),
    compose_id: _.get(artifact, 'id'),
    compose_type: _.get(artifact, 'compose_type'),
    release_type: _.get(artifact, 'release_type'),
  };
  return searchable;
};

const mkSearchableContainerImageTestV1 = (
  fq_msg: FileQueueMessage,
): SearchableTestContainerImage => {
  const { broker_topic, body, broker_extra, broker_msg_id } = fq_msg;
  const { artifact } = body;
  var thread_id = mkThreadId(fq_msg);
  var test_state = _.last(_.split(broker_topic, '.')) as string;
  var test_stage = _.nth(_.split(broker_topic, '.'), -2) as string;
  let test_case_name;
  if (isTestStage(broker_topic)) {
    test_case_name = makeTestCaseName(body);
  }
  const searchable: SearchableTestContainerImage = {
    id: _.get(artifact, 'id'),
    nvr: _.get(artifact, 'nvr'),
    tag: _.get(artifact, 'tag'),
    type: _.get(artifact, 'type'),
    /* A digest that uniquely identifies the image within a repository. */
    name: _.get(artifact, 'name'),
    source: _.get(artifact, 'source'),
    issuer: _.get(artifact, 'issuer'),
    task_id: _.get(artifact, 'task_id'),
    build_id: _.get(artifact, 'build_id'),
    scratch: _.get(artifact, 'scratch'),
    component: _.get(artifact, 'component'),
    namespace: _.get(artifact, 'namespace'),
    full_names: _.get(artifact, 'full_names'),
    registry_url: _.get(artifact, 'registry_url'),
    thread_id,
    /** state: complete, running */
    test_state,
    /** stage: build, test */
    test_stage,
    test_case_name,
    broker_msg_id,
    broker_topic,
  };
  return searchable;
};

const mkSearchableContainerImageTestParentV1 = (
  fq_msg: FileQueueMessage,
): SearchableContainerImage => {
  const { body } = fq_msg;
  const { artifact } = body;
  const searchable: SearchableContainerImage = {
    id: _.get(artifact, 'id'),
    nvr: _.get(artifact, 'nvr'),
    tag: _.get(artifact, 'tag'),
    type: _.get(artifact, 'type'),
    /* A digest that uniquely identifies the image within a repository. */
    name: _.get(artifact, 'name'),
    source: _.get(artifact, 'source'),
    issuer: _.get(artifact, 'issuer'),
    task_id: _.get(artifact, 'task_id'),
    build_id: _.get(artifact, 'build_id'),
    scratch: _.get(artifact, 'scratch'),
    component: _.get(artifact, 'component'),
    namespace: _.get(artifact, 'namespace'),
    full_names: _.get(artifact, 'full_names'),
    registry_url: _.get(artifact, 'registry_url'),
  };
  return searchable;
};

const mkParentDocId = (fq_msg: FileQueueMessage): string => {
  const { body } = fq_msg;
  const { artifact } = body;
  const type = artifact.type;
  const id = artifact.id;
  return `${type}-${id}`;
};

/**
 * Declare:
 * * set() from most specialized to most global regexes
 * * payload handlers are based on message version
 */
/**
 * RPM builds
 */
const searchableRpmTestHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();
const searchableRpmTestParentHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();
searchableRpmTestHandlers.set(/^.*$/, mkSearchableRpmTestV1);
searchableRpmTestParentHandlers.set(/^.*$/, mkSearchableRpmTestParentV1);
/**
 * MBS builds
 */
const searchableMbsTestHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();
const searchableMbsTestParentHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();
searchableMbsTestHandlers.set(/^.*$/, mkSearchableMbsTestV1);
searchableMbsTestParentHandlers.set(/^.*$/, mkSearchableMbsTestParentV1);
/**
 * Composes
 */
const searchableComposeTestHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();
const searchableComposeTestParentHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();
searchableComposeTestHandlers.set(/^.*$/, mkSearchableComposeTestV1);
searchableComposeTestParentHandlers.set(
  /^.*$/,
  mkSearchableComposeTestParentV1,
);
/**
 * Container images
 */
const searchableContainerImageTestHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();
const searchableContainerImageTestParentHandlers: TSearchableHandlersSet =
  new Map<RegExp, TGetSearchable>();
searchableContainerImageTestHandlers.set(
  /^.*$/,
  mkSearchableContainerImageTestV1,
);
searchableContainerImageTestParentHandlers.set(
  /^.*$/,
  mkSearchableContainerImageTestParentV1,
);

const handlerRpmTest = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Update[]> => {
  const { broker_msg_id, body, broker_extra } = fq_msg;
  const { artifact } = body;
  assert_is_valid(artifact, 'valid_artifact_issuer');
  /** used to make parent document ID */
  const docId = broker_msg_id;
  const artifactType = artifact.type;
  const searchable = mkSearchable(
    fq_msg,
    searchableRpmTestHandlers,
  ) as SearchableTestRpm;
  const searchableParent = mkSearchable(
    fq_msg,
    searchableRpmTestParentHandlers,
  ) as SearchableRpm;
  const searchable_text = messageToString(body) as string;
  const parentDocId = mkParentDocId(fq_msg);
  const indexName: string = getIndexName(artifactContext, artifactType);
  const messageData = makeMessageData(fq_msg);
  const doc: Document = {
    searchable,
    searchable_text,
    '@timestamp': broker_extra.timestamp,
    message: messageData,
    artifact_message: {
      name: 'message',
      parent: parentDocId,
    },
  };
  const parentDoc: Document = {
    searchable: searchableParent,
    '@timestamp': broker_extra.timestamp,
    artifact_message: {
      name: 'artifact',
    },
  };
  const routing = parentDocId;
  const updateForBrokerMsg: Update = {
    doc,
    docId,
    routing,
    indexName,
    doc_as_upsert: true,
  };
  log(' [i] handlerRpmTest updated doc: %s%o', '\n', updateForBrokerMsg);
  const updateForParent: Update = {
    doc: {},
    docId: parentDocId,
    /* upsert() - jumps into action, only, and only if, there is no document */
    upsert: parentDoc,
    routing,
    indexName,
    doc_as_upsert: false,
  };
  return [updateForBrokerMsg, updateForParent];
};

const handlerMbsTest = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Update[]> => {
  const { broker_msg_id, body, broker_extra } = fq_msg;
  const { artifact } = body;
  /** used to make parent document ID */
  const docId = broker_msg_id;
  const artifact_type = artifact.type;
  const searchable = mkSearchable(
    fq_msg,
    searchableMbsTestHandlers,
  ) as SearchableTestMbs;
  const searchableParent = mkSearchable(
    fq_msg,
    searchableMbsTestParentHandlers,
  ) as SearchableMbs;
  const searchable_text = messageToString(body) as string;
  const parentDocId = mkParentDocId(fq_msg);
  const indexName: string = getIndexName(artifactContext, artifact_type);
  const messageData = makeMessageData(fq_msg);
  const doc: Document = {
    searchable,
    searchable_text,
    '@timestamp': broker_extra.timestamp,
    message: messageData,
    artifact_message: {
      name: 'message',
      parent: parentDocId,
    },
  };
  const parentDoc: Document = {
    searchable: searchableParent,
    '@timestamp': broker_extra.timestamp,
    artifact_message: {
      name: 'artifact',
    },
  };
  const routing = parentDocId;
  const updateForBrokerMsg: Update = {
    doc,
    docId,
    routing,
    indexName,
    doc_as_upsert: true,
  };
  log(' [i] handlerMbsTest updated doc: %s%o', '\n', update);
  const updateForParent: Update = {
    doc: {},
    docId: parentDocId,
    /* upsert() - jumps into action, only, and only if, there is no document */
    upsert: parentDoc,
    routing,
    indexName,
    doc_as_upsert: false,
  };
  return [updateForBrokerMsg, updateForParent];
};

const handlerComposeTest = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Update[]> => {
  const { broker_msg_id, body, broker_extra } = fq_msg;
  const { artifact } = body;
  const artifact_type = artifact.type;
  const searchable = mkSearchable(
    fq_msg,
    searchableComposeTestHandlers,
  ) as SearchableTestCompose;
  const searchableParent = mkSearchable(
    fq_msg,
    searchableComposeTestParentHandlers,
  ) as SearchableMbs;
  const searchable_text = messageToString(body) as string;
  /** used to make parent document ID */
  const docId = broker_msg_id;
  const parentDocId = mkParentDocId(fq_msg);
  const indexName: string = getIndexName(artifactContext, artifact_type);
  const messageData = makeMessageData(fq_msg);
  const doc: Document = {
    searchable,
    searchable_text,
    '@timestamp': broker_extra.timestamp,
    message: messageData,
    artifact_message: {
      name: 'message',
      parent: parentDocId,
    },
  };
  const parentDoc: Document = {
    searchable: searchableParent,
    '@timestamp': broker_extra.timestamp,
    artifact_message: {
      name: 'artifact',
    },
  };
  const routing = parentDocId;
  const updateForBrokerMsg: Update = {
    doc,
    docId,
    routing,
    indexName,
    doc_as_upsert: true,
  };
  log(' [i] handlerComposeTest updated doc: %s%o', '\n', update);
  const updateForParent: Update = {
    doc: {},
    docId: parentDocId,
    /* upsert() - jumps into action, only, and only if, there is no document */
    upsert: parentDoc,
    routing,
    indexName,
    doc_as_upsert: false,
  };
  return [updateForBrokerMsg, updateForParent];
};

const handlerContainerImageTest = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Update[]> => {
  const { broker_msg_id, body, broker_extra } = fq_msg;
  const { artifact } = body;
  assert_is_valid(artifact, 'valid_artifact_issuer');
  /** used to make parent document ID */
  const docId = broker_msg_id;
  const artifact_type = artifact.type;
  const searchable = mkSearchable(
    fq_msg,
    searchableContainerImageTestHandlers,
  ) as SearchableTestContainerImage;
  const searchableParent = mkSearchable(
    fq_msg,
    searchableComposeTestParentHandlers,
  ) as SearchableContainerImage;
  const searchable_text = messageToString(body) as string;
  const parentDocId = mkParentDocId(fq_msg);
  const indexName: string = getIndexName(artifactContext, artifact_type);
  const messageData = makeMessageData(fq_msg);
  const doc: Document = {
    searchable,
    searchable_text,
    '@timestamp': broker_extra.timestamp,
    message: messageData,
    artifact_message: {
      name: 'message',
      parent: parentDocId,
    },
  };
  const parentDoc: Document = {
    searchable: searchableParent,
    '@timestamp': broker_extra.timestamp,
    artifact_message: {
      name: 'artifact',
    },
  };
  const routing = parentDocId;
  const updateForBrokerMsg: Update = {
    doc,
    docId,
    routing,
    indexName,
    doc_as_upsert: true,
  };
  log(' [i] handlerContainerImageTest updated doc: %s%o', '\n', update);
  const updateForParent: Update = {
    doc: {},
    docId: parentDocId,
    /* upsert() - jumps into action, only, and only if, there is no document */
    upsert: parentDoc,
    routing,
    indexName,
    doc_as_upsert: false,
  };
  return [updateForBrokerMsg, updateForParent];
};

const handlerRpmTestRedhat: THandler = _.partial(handlerRpmTest, 'redhat');
const handlerRpmTestCentos: THandler = _.partial(handlerRpmTest, 'centos');
const handlerComposeTestCentos: THandler = _.partial(
  handlerComposeTest,
  'centos',
);
const handlerComposeTestRedhat: THandler = _.partial(
  handlerComposeTest,
  'redhat',
);
const handlerComposeBuildRedhat: THandler = _.partial(
  handlerComposeTest,
  'redhat',
);
const handlerContainerImageTestRedhat: THandler = _.partial(
  handlerContainerImageTest,
  'redhat',
);

const handlerMbsTestRedhat: THandler = _.partial(handlerMbsTest, 'redhat');
const handlerMbsTestFedora: THandler = _.partial(handlerMbsTest, 'fedora');

export const handlers: THandlersSet = new Map<RegExp, THandler>();

/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/brew-build.test.complete.yaml
 */
handlers.set(
  /^org.centos.prod.ci.koji-build.test.(complete|queued|running|error)$/,
  handlerRpmTestCentos,
);
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.(brew-build|koji-build)\.test\.(complete|queued|running|error)$/,
  handlerRpmTestRedhat,
);
/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.productmd-compose.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.complete&delta=127800
 */
handlers.set(
  /^org.centos.prod.ci.productmd-compose.test.(complete|queued|running|error)$/,
  handlerComposeTestCentos,
);
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.productmd-compose\.test\.(complete|queued|running|error)$/,
  handlerComposeTestRedhat,
);
/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.build.complete&delta=127800
 */
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.productmd-compose\.build\.(complete|error)$/,
  handlerComposeBuildRedhat,
);
/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.build.complete&delta=127800
 * https://dashboard.osci.redhat.com/#/artifact/productmd-compose/aid/Supp-9.0.0-RHEL-9-20201008.1
 */

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.cvp.redhat-container-image.test.complete&delta=86400
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-container-image.test.complete.yaml
 */
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.redhat-container-image\.test\.(complete|queued|running|error)$/,
  handlerContainerImageTestRedhat,
);

/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.fedora-module.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.complete&delta=127800
 */
handlers.set(
  /^org.centos.prod.ci.fedora-module.test.(complete|queued|running|error)$/,
  handlerMbsTestFedora,
);
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.redhat-module\.test\.(complete|queued|running|error)$/,
  handlerMbsTestRedhat,
);
