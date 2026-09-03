-- 連結晶片（FB/IG/Threads/噗浪…）＋分類標籤（陣營／種族）
ALTER TABLE projects ADD COLUMN tag_groups TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
ALTER TABLE characters ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
ALTER TABLE characters ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
