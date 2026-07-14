---
uuid: 21fe6433-a810-41bb-85d7-6c96c8a8397d
title: E-shop business overview
summary: Describes the business boundaries shared by the product, user, and order packages.
scope: project
status: approved
audience:
  - business
  - engineering
  - ai-agent
tags:
  - commerce
  - overview
concepts:
  - Product
  - User
  - Order
owners:
  - commerce-platform
language: en
metadata:
  - name: domain
    value: commerce
---

# E-shop business overview

The e-shop model describes the information needed to publish products, identify customers, and fulfil orders.

## Business boundaries

The product package owns the catalogue and inventory view. The user package owns customer identity and preferences. The order package owns quotes, confirmed purchases, payment state, and fulfilment.

## Shared language

An **order** is a confirmed customer commitment. A **quote** is a priced proposal that can still expire or change before confirmation.
