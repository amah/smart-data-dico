---
uuid: 84961313-a6d5-47c3-a26d-b516c4400326
title: Order lifecycle
summary: Explains how an order progresses from confirmation to completion or cancellation.
scope: package
status: approved
audience:
  - business
  - engineering
  - ai-agent
tags:
  - order
  - lifecycle
concepts:
  - Order
  - OrderStatus
related:
  - ref: document:21fe6433-a810-41bb-85d7-6c96c8a8397d
  - ref: chunk:doc:21fe6433-a810-41bb-85d7-6c96c8a8397d#business-boundaries
owners:
  - order-management
language: en
metadata:
  - name: domain
    value: commerce
---

# Order lifecycle

An order represents a confirmed intention to purchase products at an agreed price.

## Creation

An order can only be created from a valid quote. The quote must not be expired, product availability must have been checked, and a delivery address must be present.

<!-- chunk: cancellation-policy -->

## Cancellation

Customers may cancel an order until fulfilment starts. Orders containing personalized products require manual review instead of automatic cancellation.

## Completion

An order is complete after payment is accepted and every shippable item has been delivered.
