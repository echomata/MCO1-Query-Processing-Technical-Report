-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: localhost    Database: nyc_yellow_taxi_2025
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `dim_date`
--

DROP TABLE IF EXISTS `dim_date`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dim_date` (
  `date_sk` int NOT NULL,
  `full_date` date NOT NULL,
  `year` smallint NOT NULL,
  `quarter` tinyint NOT NULL,
  `month` tinyint NOT NULL,
  `month_name` varchar(12) NOT NULL,
  `day` tinyint NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `day_name` varchar(12) NOT NULL,
  `week_of_year` tinyint NOT NULL,
  `is_weekend` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`date_sk`),
  UNIQUE KEY `uq_full_date` (`full_date`),
  KEY `idx_year_month` (`year`,`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dim_location`
--

DROP TABLE IF EXISTS `dim_location`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dim_location` (
  `location_sk` smallint NOT NULL,
  `tlc_id` smallint NOT NULL,
  `zone` varchar(100) NOT NULL,
  `borough` varchar(50) NOT NULL,
  `service_zone` varchar(50) NOT NULL,
  PRIMARY KEY (`location_sk`),
  UNIQUE KEY `uq_tlc` (`tlc_id`),
  KEY `idx_borough` (`borough`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dim_payment`
--

DROP TABLE IF EXISTS `dim_payment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dim_payment` (
  `payment_sk` tinyint NOT NULL,
  `payment_desc` varchar(50) NOT NULL,
  PRIMARY KEY (`payment_sk`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dim_ratecode`
--

DROP TABLE IF EXISTS `dim_ratecode`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dim_ratecode` (
  `ratecode_sk` smallint NOT NULL,
  `rate_desc` varchar(50) NOT NULL,
  PRIMARY KEY (`ratecode_sk`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dim_vendor`
--

DROP TABLE IF EXISTS `dim_vendor`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dim_vendor` (
  `vendor_sk` tinyint NOT NULL,
  `vendor_name` varchar(100) NOT NULL,
  PRIMARY KEY (`vendor_sk`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `etl_batch_log`
--

DROP TABLE IF EXISTS `etl_batch_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `etl_batch_log` (
  `src_file` varchar(64) NOT NULL,
  `src_rows` bigint NOT NULL,
  `loaded_rows` bigint NOT NULL,
  `rejected_rows` bigint NOT NULL,
  `loaded_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` varchar(16) NOT NULL DEFAULT 'completed' COMMENT 'running|completed|failed',
  `file_sha256` char(64) DEFAULT NULL COMMENT 'sha256 of source parquet at load time',
  `file_bytes` bigint DEFAULT NULL,
  `duplicate_rows` bigint NOT NULL DEFAULT '0',
  `suspicious_rows` bigint NOT NULL DEFAULT '0',
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`src_file`),
  CONSTRAINT `chk_batch_status` CHECK ((`status` in (_utf8mb4'running',_utf8mb4'completed',_utf8mb4'failed')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_trip`
--

DROP TABLE IF EXISTS `fact_trip`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_trip` (
  `trip_sk` bigint NOT NULL AUTO_INCREMENT,
  `pickup_date_sk` int NOT NULL,
  `dropoff_date_sk` int NOT NULL,
  `pickup_datetime` datetime NOT NULL,
  `dropoff_datetime` datetime NOT NULL,
  `pu_location_sk` smallint NOT NULL,
  `do_location_sk` smallint NOT NULL,
  `vendor_sk` tinyint DEFAULT NULL,
  `ratecode_sk` smallint DEFAULT NULL,
  `store_and_fwd_flag` char(1) DEFAULT NULL COMMENT 'TLC store_and_fwd_flag Y/N',
  `payment_sk` tinyint NOT NULL,
  `passenger_count` tinyint DEFAULT NULL,
  `trip_distance` decimal(10,2) NOT NULL COMMENT 'TLC trip_distance miles; widened 8,2->10,2: source max 397994.37 overflows 8,2',
  `duration_min` int NOT NULL,
  `fare_amount` decimal(10,2) NOT NULL,
  `extra` decimal(10,2) NOT NULL DEFAULT '0.00',
  `mta_tax` decimal(10,2) NOT NULL DEFAULT '0.00',
  `tip_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `tolls_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `improvement_surcharge` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(10,2) NOT NULL,
  `congestion_surcharge` decimal(10,2) DEFAULT NULL,
  `airport_fee` decimal(10,2) DEFAULT NULL,
  `cbd_congestion_fee` decimal(10,2) DEFAULT NULL,
  `src_file` varchar(64) DEFAULT NULL COMMENT 'batch id, e.g. 2025-01',
  `src_row` bigint DEFAULT NULL COMMENT '0-based row index in source file',
  PRIMARY KEY (`trip_sk`),
  KEY `idx_pickup_date` (`pickup_date_sk`),
  KEY `idx_pu` (`pu_location_sk`),
  KEY `idx_do` (`do_location_sk`),
  KEY `idx_payment` (`payment_sk`),
  KEY `idx_dropoff_date` (`dropoff_date_sk`),
  KEY `idx_vendor` (`vendor_sk`),
  KEY `idx_ratecode` (`ratecode_sk`),
  KEY `idx_pickup_ts` (`pickup_datetime`),
  KEY `idx_dropoff_ts` (`dropoff_datetime`),
  KEY `idx_src_file` (`src_file`),
  CONSTRAINT `fk_fact_do_loc` FOREIGN KEY (`do_location_sk`) REFERENCES `dim_location` (`location_sk`),
  CONSTRAINT `fk_fact_dropoff_date` FOREIGN KEY (`dropoff_date_sk`) REFERENCES `dim_date` (`date_sk`),
  CONSTRAINT `fk_fact_payment` FOREIGN KEY (`payment_sk`) REFERENCES `dim_payment` (`payment_sk`),
  CONSTRAINT `fk_fact_pickup_date` FOREIGN KEY (`pickup_date_sk`) REFERENCES `dim_date` (`date_sk`),
  CONSTRAINT `fk_fact_pu_loc` FOREIGN KEY (`pu_location_sk`) REFERENCES `dim_location` (`location_sk`),
  CONSTRAINT `fk_fact_ratecode` FOREIGN KEY (`ratecode_sk`) REFERENCES `dim_ratecode` (`ratecode_sk`),
  CONSTRAINT `fk_fact_vendor` FOREIGN KEY (`vendor_sk`) REFERENCES `dim_vendor` (`vendor_sk`),
  CONSTRAINT `chk_duration` CHECK ((`duration_min` >= 0)),
  CONSTRAINT `chk_store_fwd` CHECK (((`store_and_fwd_flag` is null) or (`store_and_fwd_flag` in (_utf8mb4'Y',_utf8mb4'N')))),
  CONSTRAINT `chk_trip_dist` CHECK ((`trip_distance` >= 0)),
  CONSTRAINT `chk_ts_order` CHECK ((`dropoff_datetime` >= `pickup_datetime`))
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_trip_reject`
--

DROP TABLE IF EXISTS `fact_trip_reject`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_trip_reject` (
  `reject_sk` bigint NOT NULL AUTO_INCREMENT,
  `src_file` varchar(64) NOT NULL,
  `src_row` bigint NOT NULL,
  `reject_reason` varchar(200) NOT NULL,
  `pickup_datetime` datetime DEFAULT NULL,
  `dropoff_datetime` datetime DEFAULT NULL,
  `pu_id` smallint DEFAULT NULL,
  `do_id` smallint DEFAULT NULL,
  `payload` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`reject_sk`),
  KEY `idx_reject_file` (`src_file`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-16  1:20:22
