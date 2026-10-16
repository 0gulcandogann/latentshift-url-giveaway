import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';

export function openStorage(filename){
  if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS imports (post_key TEXT PRIMARY KEY, result_json TEXT NOT NULL, rows_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS session (id INTEGER PRIMARY KEY CHECK (id=1), state_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS photos (url TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);`);
  return {
    getImport(key){const row=db.prepare('SELECT result_json FROM imports WHERE post_key=?').get(key);return row?JSON.parse(row.result_json):null;},
    putImport(key,result,rows){db.prepare('INSERT INTO imports VALUES (?, ?, ?) ON CONFLICT(post_key) DO UPDATE SET result_json=excluded.result_json, rows_json=excluded.rows_json').run(key,JSON.stringify(result),JSON.stringify(rows));},
    getSession(){const row=db.prepare('SELECT state_json FROM session WHERE id=1').get();return row?JSON.parse(row.state_json):null;},
    putSession(state){db.prepare('INSERT INTO session VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json').run(JSON.stringify(state));},
    getPhoto(url){return db.prepare('SELECT mime,bytes FROM photos WHERE url=?').get(url)||null;},
    putPhoto(url,mime,bytes){db.prepare('INSERT INTO photos VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes').run(url,mime,bytes);},
    close(){db.close();}
  };
}
