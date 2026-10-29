// Редактор работает с текстом без BOM и с переносами "\n".
// При сохранении возвращаем файлу исходный вид, чтобы git не показывал изменёнными все строки.

export interface FileFormat {
  bom: boolean;
  crlf: boolean;
}

export interface ParsedFile {
  text: string;
  format: FileFormat;
}

export function parseFile(raw: string): ParsedFile {
  const bom = raw.startsWith("﻿");
  const body = bom ? raw.slice(1) : raw;
  const crlf = body.includes("\r\n");
  return { text: body.replace(/\r\n/g, "\n"), format: { bom, crlf } };
}

export function serializeFile(text: string, format: FileFormat): string {
  const body = format.crlf ? text.replace(/\n/g, "\r\n") : text;
  return (format.bom ? "﻿" : "") + body;
}
