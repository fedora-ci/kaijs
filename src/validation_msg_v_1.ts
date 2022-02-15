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

const log = debug('kaijs:validation_msg');

/**
 * Messages for tag: 1. and 0.2
 * https://pagure.io/fedora-ci/messages
 */

/**
 * https://github.com/sideway/joi/blob/v9.0.4/API.md
 * https://joi.dev/api/?v=17.4.0
 */

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/contact.yaml
 */
const schema_contact = Joi.object({
  name: Joi.string().required(),
  team: Joi.string().required(),
  docs: Joi.string().uri().required(),
  email: Joi.string().email().required(),
  url: Joi.string().uri(),
  irc: Joi.string(),
  slack: Joi.string(),
  version: Joi.string(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/run.yaml
 */
const schema_run = Joi.object({
  url: Joi.string().uri().required(),
  log: Joi.string().required(),
  log_raw: Joi.string(),
  log_stream: Joi.string(),
  rebuild: Joi.string(),
  trigger_rebuild: Joi.string(),
  debug: Joi.string(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/rpm-build.yaml
 */
const schema_rpm_build = Joi.object({
  type: Joi.string().valid('koji-build', 'brew-build').required(),
  id: Joi.number().integer().greater(0).required(),
  component: Joi.string().required(),
  issuer: Joi.string().required(),
  scratch: Joi.boolean().required(),
  nvr: Joi.string().required(),
  baseline: Joi.string(),
  dependencies: Joi.array().items(Joi.string()),
  source: Joi.string(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/stage.yaml
 */
const schema_stage = Joi.object({
  name: Joi.string().required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/pipeline.yaml
 */
const schema_pipeline = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().required(),
  build: Joi.string(),
  stage: schema_stage,
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/test-common.yaml
 */
const schema_test_common = Joi.object({
  category: Joi.string()
    .valid(
      'functional',
      'integration',
      'interoperability',
      'static-analysis',
      'system',
      'validation',
      'performance'
    )
    .required(),
  namespace: Joi.string().required(),
  type: Joi.string().required(),
  docs: Joi.string().uri(),
  label: Joi.array().items(Joi.string()),
  lifetime: Joi.number().integer().greater(0),
  progress: Joi.number().integer().min(2).max(100),
  scenario: Joi.string(),
  xunit: Joi.string(),
  xunit_urls: Joi.array().items(Joi.string()),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/test-complete.yaml
 */
const schema_test_complete = Joi.object({
  result: Joi.string()
    .valid('passed', 'failed', 'info', 'needs_inspection', 'not_applicable')
    .required(),
  runtime: Joi.number().integer(),
  output: Joi.string(),
  output_urls: Joi.array().items(Joi.string().uri()),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/notification.yaml
 */
const schema_notification = Joi.object({
  recipients: Joi.array().items(Joi.string()),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/system.yaml
 */
const schema_system = Joi.object({
  os: Joi.string().required(),
  provider: Joi.string().required(),
  architecture: Joi.string().required(),
  variant: Joi.string(),
  label: Joi.string(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/common.yaml
 */
const schema_common = Joi.object({
  generated_at: Joi.date().iso(),
  note: Joi.string(),
  version: Joi.string(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/error.yaml
 */
const schema_error = Joi.object({
  issue_url: Joi.string().uri(),
  reason: Joi.string().required(),
});

/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/brew-build.test.complete.yaml
 */
export const schema_rpm_build_test_complete = Joi.object({
  contact: schema_contact.required(),
  run: schema_run.required(),
  artifact: schema_rpm_build.required(),
  pipeline: schema_pipeline.required(),
  test: Joi.any()
    .concat(schema_test_common)
    .concat(schema_test_complete)
    .required(),
  notification: schema_notification,
  system: Joi.array().items(schema_system).required(),
  generated_at: schema_common.extract('generated_at').required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/brew-build.test.error.yaml
 */
export const schema_rpm_build_test_error = Joi.object({
  contact: schema_contact.required(),
  run: schema_run.required(),
  artifact: schema_rpm_build.required(),
  pipeline: schema_pipeline.required(),
  test: schema_test_common.required(),
  error: schema_error.required(),
  notification: schema_notification,
  generated_at: schema_common.extract('generated_at').required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/brew-build.test.queued.yaml
 */
export const schema_rpm_build_test_queued = Joi.object({
  contact: schema_contact.required(),
  run: schema_run.required(),
  artifact: schema_rpm_build.required(),
  pipeline: schema_pipeline.required(),
  test: schema_test_common.required(),
  generated_at: schema_common.extract('generated_at').required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/brew-build.test.running.yaml
 */
export const schema_rpm_build_test_running = Joi.object({
  contact: schema_contact.required(),
  run: schema_run.required(),
  artifact: schema_rpm_build.required(),
  pipeline: schema_pipeline.required(),
  test: schema_test_common.required(),
  generated_at: schema_common.extract('generated_at').required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.complete&delta=127800
 */
export const schema_module_test_complete = Joi.object({
  // XXX: add me
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.error.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.error&delta=127800
 */
export const schema_module_test_error = Joi.object({
  // XXX: add me
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.qeued.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.queued&delta=127800
 */
export const schema_module_test_queued = Joi.object({
  // XXX: add me
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.running.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.running&delta=127800
 */
export const schema_module_test_running = Joi.object({
  // XXX: add me
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.complete&delta=127800
 */
export const schema_compose_test_complete = Joi.object({
  // XXX: add me
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.error.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.error&delta=127800
 */
export const schema_compose_test_error = Joi.object({
  // XXX: add me
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.qeued.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.queued&delta=127800
 */
export const schema_compose_test_queued = Joi.object({
  // XXX: add me
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.running.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.running&delta=127800
 */
export const schema_compose_test_running = Joi.object({
  // XXX: add me
});
