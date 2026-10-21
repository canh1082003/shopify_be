-- ==============================================================================
-- ORDER WATCHDOG — SHOPIFY SAAS MYSQL DATABASE SCHEMA (NO FOREIGN KEYS)
-- Independent tables with Primary Keys & Performance Indexes only
-- Zero Foreign Key constraints (Managed at application level)
-- Compatible with MySQL 8.0+ / MariaDB 10.5+ / PlanetScale / AWS RDS
-- ==============================================================================

-- 1. Create Database
CREATE DATABASE IF NOT EXISTS `shopify_order_watchdog`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `shopify_order_watchdog`;

-- ------------------------------------------------------------------------------
-- Table 1: shops (Merchant stores installed with the app)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `shops` (
  `id` VARCHAR(36) NOT NULL,
  `shop_domain` VARCHAR(255) NOT NULL,
  `shopify_shop_id` VARCHAR(100) NULL,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NULL,
  `timezone` VARCHAR(50) NOT NULL DEFAULT 'UTC',
  `currency` VARCHAR(10) NOT NULL DEFAULT 'USD',
  `plan` VARCHAR(50) NOT NULL DEFAULT 'basic',
  `is_demo` BOOLEAN NOT NULL DEFAULT FALSE,
  `installed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `uninstalled_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_shop_domain` (`shop_domain`),
  UNIQUE KEY `uk_shopify_shop_id` (`shopify_shop_id`),
  KEY `idx_shops_installed` (`installed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- Table 2: shopify_sessions (Encrypted OAuth access tokens)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `shopify_sessions` (
  `id` VARCHAR(36) NOT NULL,
  `shop_id` VARCHAR(36) NOT NULL,
  `session_type` ENUM('offline', 'online') NOT NULL DEFAULT 'offline',
  `encrypted_access_token` TEXT NOT NULL,
  `iv` VARCHAR(64) NOT NULL COMMENT 'AES-256-GCM IV',
  `auth_tag` VARCHAR(64) NOT NULL COMMENT 'AES-256-GCM Auth Tag',
  `scope` VARCHAR(500) NOT NULL,
  `expires_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_sessions_shop_id` (`shop_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- Table 3: settings (SLA thresholds & email digest configuration per shop)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `id` VARCHAR(36) NOT NULL,
  `shop_id` VARCHAR(36) NOT NULL,
  `overdue_threshold_hours` INT NOT NULL DEFAULT 24 COMMENT 'Hours until order is overdue',
  `warning_lead_time_hours` INT NOT NULL DEFAULT 4 COMMENT 'Advance warning in hours',
  `email_enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `notification_email` VARCHAR(255) NOT NULL,
  `digest_frequency` ENUM('immediate', 'daily', 'hourly') NOT NULL DEFAULT 'immediate',
  `auto_acknowledge` BOOLEAN NOT NULL DEFAULT FALSE,
  `exclude_tags` JSON NOT NULL COMMENT 'Array of tags excluded from monitoring',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_settings_shop_id` (`shop_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- Table 4: orders (Fulfillment orders synced from Shopify with SLA tracking)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `orders` (
  `id` VARCHAR(36) NOT NULL,
  `shop_id` VARCHAR(36) NOT NULL,
  `shopify_order_id` VARCHAR(100) NOT NULL,
  `order_number` VARCHAR(50) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `customer_name` VARCHAR(255) NULL,
  `customer_email` VARCHAR(255) NULL,
  `financial_status` VARCHAR(50) NOT NULL DEFAULT 'pending',
  `fulfillment_status` VARCHAR(50) NOT NULL DEFAULT 'unfulfilled',
  `total_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `currency_code` VARCHAR(10) NOT NULL DEFAULT 'USD',
  `total_items` INT NOT NULL DEFAULT 1,
  `fulfillable_quantity` INT NOT NULL DEFAULT 1,
  `line_items` JSON NOT NULL COMMENT 'Embedded JSON array of items',
  `deadline` DATETIME(3) NULL COMMENT 'Computed fulfillment deadline',
  `is_overdue` BOOLEAN NOT NULL DEFAULT FALSE,
  `overdue_minutes` INT NOT NULL DEFAULT 0,
  `shopify_url` VARCHAR(500) NULL,
  `processed_at` DATETIME(3) NULL,
  `cancelled_at` DATETIME(3) NULL,
  `last_synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_orders_shop_shopify_id` (`shop_id`, `shopify_order_id`),
  KEY `idx_orders_shop_overdue` (`shop_id`, `is_overdue`, `created_at`),
  KEY `idx_orders_shop_number` (`shop_id`, `order_number`),
  KEY `idx_orders_fulfillment` (`shop_id`, `fulfillment_status`),
  KEY `idx_orders_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- Table 5: alerts (SLA overdue & warning alerts)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `alerts` (
  `id` VARCHAR(36) NOT NULL,
  `shop_id` VARCHAR(36) NOT NULL,
  `order_id` VARCHAR(36) NOT NULL,
  `order_number` VARCHAR(50) NOT NULL,
  `severity` ENUM('warning', 'critical', 'resolved') NOT NULL DEFAULT 'warning',
  `status` ENUM('active', 'acknowledged', 'resolved') NOT NULL DEFAULT 'active',
  `reason` TEXT NOT NULL,
  `elapsed_hours` DECIMAL(6, 2) NOT NULL DEFAULT 0.00,
  `threshold_hours` INT NOT NULL DEFAULT 24,
  `acknowledged_at` DATETIME(3) NULL,
  `resolved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_alerts_shop_status` (`shop_id`, `status`, `severity`, `created_at`),
  KEY `idx_alerts_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- Table 6: notification_logs (Audit log for outbound emails)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notification_logs` (
  `id` VARCHAR(36) NOT NULL,
  `shop_id` VARCHAR(36) NOT NULL,
  `alert_id` VARCHAR(36) NULL,
  `recipient` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `delivery_status` ENUM('sent', 'failed', 'simulated_no_credentials') NOT NULL,
  `error_message` TEXT NULL,
  `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_notif_shop_sent` (`shop_id`, `sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- SEED INITIAL DEMO DATA (For quick testing)
-- ------------------------------------------------------------------------------
INSERT IGNORE INTO `shops` (`id`, `shop_domain`, `shopify_shop_id`, `name`, `email`, `timezone`, `currency`, `plan`, `is_demo`)
VALUES ('shop_demo_001', 'quickstart-watchdog.myshopify.com', 'shop_gid_001', 'Order Watchdog Demo Store', 'merchant@example.com', 'America/New_York', 'USD', 'Shopify Plus', TRUE);

INSERT IGNORE INTO `settings` (`id`, `shop_id`, `overdue_threshold_hours`, `warning_lead_time_hours`, `email_enabled`, `notification_email`, `digest_frequency`, `auto_acknowledge`, `exclude_tags`)
VALUES ('sett_demo_001', 'shop_demo_001', 24, 4, TRUE, 'merchant@example.com', 'immediate', FALSE, '["pre-order", "b2b"]');
