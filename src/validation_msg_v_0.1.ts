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
 * Messages for tag: < 0.2
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas
 */

/**
 * https://github.com/sideway/joi/blob/v9.0.4/API.md
 * https://joi.dev/api/?v=17.4.0
 */

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/contact.yaml
 */
const schema_contact = Joi.object({
  name: Joi.string().required(),
  team: Joi.string().required(),
  /**
   * docs must be required but, a lot of legacy CI systems do not set it
   */
  docs: Joi.string().uri(),
  email: Joi.string().email().required(),
  url: Joi.string().uri(),
  irc: Joi.string(),
  environment: Joi.string().valid('production', 'stage'),
  version: Joi.string(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/run.yaml
 */
const schema_run = Joi.object({
  url: Joi.string().uri().required(),
  log: Joi.string().required(),
  log_raw: Joi.string(),
  log_stream: Joi.string(),
  rebuild: Joi.string(),
  debug: Joi.string(),
  additional_urls: Joi.object({}).min(1),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/rpm-build.yaml
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
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/system.yaml
 */
const schema_system = Joi.object({
  os: Joi.string().required(),
  provider: Joi.string().required(),
  architecture: Joi.string().required(),
  variant: Joi.string(),
  /**
   * Support legacy messages set to: null
   */
  label: Joi.string().allow(null),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/common.yaml
 */
const schema_common = Joi.object({
  /**
   * Schema defines a set of values, but this doesn't work in real world.
    .valid(
      'functional',
      'integration',
      'interoperability',
      'static-analysis',
      'system',
      'validation',
      'performance'
    )
  */
  category: Joi.string(),
  /**
   * Support legacy messages set to: null
   */
  docs: Joi.string().uri().allow(null),
  generated_at: Joi.date().iso(),
  /**
   * Support legacy messages set to: null
   */
  issue_url: Joi.string().uri().allow(null),
  label: Joi.string(),
  lifetime: Joi.number().integer().greater(0),
  namespace: Joi.string(),
  note: Joi.string(),
  progress: Joi.number().integer().min(0).max(100),
  /**
   * Support legacy messages set to: null
   */
  reason: Joi.string().allow(null),
  recipients: Joi.array().items(Joi.string()),
  status: Joi.string().valid(
    'passed',
    'failed',
    'info',
    'needs_inspection',
    'not_applicable'
  ),
  thread_id: Joi.string(),
  type: Joi.string(),
  version: Joi.string(),
  web_url: Joi.string().uri(),
  xunit: Joi.string(),
});

/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/brew-build.test.complete.yaml
 */
export const schema_rpm_build_test_complete = Joi.object({
  ci: schema_contact.required(),
  run: schema_run.required(),
  artifact: schema_rpm_build.required(),
  system: Joi.array().items(schema_system).required(),
  docs: schema_common.extract('docs'),
  category: schema_common.extract('category').required(),
  type: schema_common.extract('type').required(),
  label: schema_common.extract('label'),
  status: schema_common.extract('status').required(),
  web_url: schema_common.extract('web_url'),
  xunit: schema_common.extract('xunit'),
  recipients: schema_common.extract('recipients'),
  thread_id: schema_common.extract('thread_id'),
  namespace: schema_common.extract('namespace').required(),
  note: schema_common.extract('note'),
  generated_at: schema_common.extract('generated_at').required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/brew-build.test.error.yaml
 */
export const schema_rpm_build_test_error = Joi.object({
  ci: schema_contact.required(),
  run: schema_run.required(),
  artifact: schema_rpm_build.required(),
  docs: schema_common.extract('docs'),
  category: schema_common.extract('category').required(),
  type: schema_common.extract('type').required(),
  label: schema_common.extract('label'),
  reason: schema_common.extract('reason').required(),
  issue_url: schema_common.extract('issue_url'),
  recipients: schema_common.extract('recipients'),
  thread_id: schema_common.extract('thread_id'),
  namespace: schema_common.extract('namespace').required(),
  note: schema_common.extract('note'),
  generated_at: schema_common.extract('generated_at').required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/brew-build.test.queued.yaml
 */
export const schema_rpm_build_test_queued = Joi.object({
  ci: schema_contact.required(),
  run: schema_run.required(),
  artifact: schema_rpm_build.required(),
  category: schema_common.extract('category').required(),
  type: schema_common.extract('type').required(),
  label: schema_common.extract('label'),
  thread_id: schema_common.extract('thread_id'),
  namespace: schema_common.extract('namespace').required(),
  note: schema_common.extract('note'),
  generated_at: schema_common.extract('generated_at').required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/brew-build.test.running.yaml
 */
export const schema_rpm_build_test_running = Joi.object({
  ci: schema_contact.required(),
  run: schema_run.required(),
  artifact: schema_rpm_build.required(),
  category: schema_common.extract('category').required(),
  type: schema_common.extract('type').required(),
  label: schema_common.extract('label'),
  lifetime: schema_common.extract('lifetime'),
  thread_id: schema_common.extract('thread_id'),
  namespace: schema_common.extract('namespace').required(),
  note: schema_common.extract('note'),
  progress: schema_common.extract('progress'),
  generated_at: schema_common.extract('generated_at').required(),
  version: schema_common.extract('version').required(),
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
