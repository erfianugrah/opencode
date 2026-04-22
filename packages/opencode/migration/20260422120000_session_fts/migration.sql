CREATE VIRTUAL TABLE IF NOT EXISTS `session_fts` USING fts5(
  content,
  session_id UNINDEXED,
  part_id UNINDEXED,
  role UNINDEXED,
  time_created UNINDEXED,
  tokenize='porter unicode61'
);
--> statement-breakpoint
INSERT INTO session_fts(content, session_id, part_id, role, time_created)
SELECT
  json_extract(p.data, '$.text'),
  p.session_id,
  p.id,
  json_extract(m.data, '$.role'),
  p.time_created
FROM part p
JOIN message m ON p.message_id = m.id
WHERE json_extract(p.data, '$.type') = 'text'
  AND json_extract(p.data, '$.text') IS NOT NULL
  AND length(json_extract(p.data, '$.text')) > 0;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS part_fts_insert AFTER INSERT ON part
WHEN json_extract(NEW.data, '$.type') = 'text'
  AND json_extract(NEW.data, '$.text') IS NOT NULL
  AND length(json_extract(NEW.data, '$.text')) > 0
BEGIN
  INSERT INTO session_fts(content, session_id, part_id, role, time_created)
  VALUES (
    json_extract(NEW.data, '$.text'),
    NEW.session_id,
    NEW.id,
    (SELECT json_extract(m.data, '$.role') FROM message m WHERE m.id = NEW.message_id),
    NEW.time_created
  );
END;
