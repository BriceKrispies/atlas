/**
 * ThreeColumnTemplate — left sidebar, main, right sidebar. CSS-only
 * chrome; see ../templates.css for the grid rules.
 *
 * Like the other templates in this bundle, no render() override exists,
 * so the <widget-host> appended by <content-page> survives untouched.
 */

import { AtlasElement } from '@atlas/core';

export class ThreeColumnTemplate extends AtlasElement {}

AtlasElement.define('template-three-column', ThreeColumnTemplate);
