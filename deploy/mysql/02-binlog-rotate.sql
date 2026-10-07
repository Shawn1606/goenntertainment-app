-- Rotates MySQL's binary log once a day, so that MYSQL_BINLOG_RETENTION_DAYS bounds it in time
-- (F-45). MySQL deletes a binary-log file only when the log rotates, and only once the file's last
-- write is older than the retention. Without a rotation by time, every change, including the rows
-- of deleted accounts, would stay in the active file until it reaches 1 GB or MySQL restarts.
-- With the daily rotation a change stays in the binary log at least MYSQL_BINLOG_RETENTION_DAYS
-- days and at most two days longer.
--
-- The db service mounts this file into the image's first-start folder (deploy/docker-compose.yml):
-- MySQL runs it as root once, on an empty db-data volume. For a volume created before this file,
-- deploy/README.md has the one command that creates the event (deploy/README.md, Logs).
-- The event runs as root, its definer: neither the app user nor the backup needs the right to
-- flush logs. The first rotation is one day after the first start, never during it. With
-- MYSQL_BINLOG_RETENTION_DAYS=off there is no binary log and the event changes nothing.
CREATE EVENT IF NOT EXISTS goenntertainment.binlog_rotate
  ON SCHEDULE EVERY 1 DAY STARTS CURRENT_TIMESTAMP + INTERVAL 1 DAY
  DO FLUSH BINARY LOGS;
