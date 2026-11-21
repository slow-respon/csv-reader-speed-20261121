// A fast drop-in for csv-reader 1.0.0 (make.fun's own reference CSV reader).
//
// It returns exactly what csv-reader 1.0.0 returns for every input {text, header}:
// {columns, rows, errors}. The reading rules, restated from the competition brief:
//
//   - A U+FEFF at the very start of the text is dropped.
//   - A record ends at LF or CRLF; a line left with no characters is no record.
//   - Outside quotes, a CR not followed by LF is dropped (error stray_cr).
//   - A field that opens with a quote runs to the next quote that is not doubled;
//     "" inside it is one quote, and each CRLF or lone CR inside it reads as LF.
//     What follows its closing quote, up to the next comma or line break, is
//     appended as it stands (error quote_junk, when the field ends, if anything
//     was appended). A quote that never closes is a literal character, and the
//     text after it is read again as unquoted (error unterminated_quote).
//   - A quote inside an unquoted field is a literal character.
//   - Fields stay strings, never trimmed or converted.
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with extra:
//     the cut fields) to the first record's width.
//   - Each error is {code, line, row}, in the order met; a record's short_row or
//     long_row when it ends. line is the 1-based line its record starts on,
//     counting every LF, CRLF and lone CR inside quotes; row is its record's
//     index in rows, null for the header.
//
// Speed comes from never building a field one character at a time. A record
// whose line holds no quote and no stray CR is split by the engine in one go;
// every other field is cut out with slices once its end is known, and a quoted
// field is found with indexOf instead of a character walk whenever it holds no
// doubled quote and no line break inside it.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field starting at pos, appending onto `head` ("" for a
  // fresh field, the quoted value for text after a closing quote). Returns
  // [value, ended, added]: added counts the characters kept here, which is
  // what decides quote_junk. pos and line are advanced past the field.
  function readUnquoted(head) {
    let start = pos;
    let parts = null;
    let added = 0;
    let ended = END;
    let p = pos;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 44) {
        ended = COMMA;
        break;
      }
      if (c === 10) {
        ended = LINE_BREAK;
        break;
      }
      if (c === 13) {
        if (text.charCodeAt(p + 1) === 10) {
          ended = LINE_BREAK;
          break;
        }
        // A CR not followed by LF is dropped (stray_cr).
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) parts = [];
        parts.push(text.slice(start, p));
        added += p - start;
        p += 1;
        start = p;
        continue;
      }
      p += 1;
    }
    added += p - start;
    let value;
    if (parts === null) {
      value = head === '' ? text.slice(start, p) : head + text.slice(start, p);
    } else {
      parts.push(text.slice(start, p));
      value = head + parts.join('');
    }
    if (ended === COMMA) {
      pos = p + 1;
    } else if (ended === LINE_BREAK) {
      pos = text.charCodeAt(p) === 13 ? p + 2 : p + 1;
      line += 1;
    } else {
      pos = p;
    }
    return [value, ended, added];
  }

  // Reads a quoted field whose opening quote is at pos. Returns [value, ended].
  // pos and line are advanced past the field.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Find the closing quote. The first quote after the opening one closes
    // the field unless it is doubled; a doubled quote is half of a pair, so
    // the scan jumps past pairs until it finds a quote that is not doubled.
    let q = text.indexOf('"', pos + 1);
    if (q !== -1 && text.charCodeAt(q + 1) === 34) {
      // Doubled quotes inside: the general walk below handles them.
      q = -2;
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    // Fast case: the first quote after the opening one is the closing quote
    // (q >= 0) and no line break sits inside it, so the value is one slice
    // and the line does not move. (q is the first quote after the opening
    // one, so no other quote can sit inside.) The check walks only the
    // quoted segment.
    if (q >= 0) {
      let hasBreak = false;
      for (let p = pos + 1; p < q; p += 1) {
        const c = text.charCodeAt(p);
        if (c === 10 || c === 13) {
          hasBreak = true;
          break;
        }
      }
      if (!hasBreak) {
        const value = text.slice(pos + 1, q);
        pos = q + 1;
        if (pos >= n) return [value, END];
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          return [value, COMMA];
        }
        if (c === 10) {
          pos += 1;
          line += 1;
          return [value, LINE_BREAK];
        }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          return [value, LINE_BREAK];
        }
        // What follows the closing quote is appended as it stands.
        const junk = readUnquoted(value);
        if (junk[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return [junk[0], junk[1]];
      }
    }
    // General case: doubled quotes and/or line breaks inside the quotes.
    // Walk the field, cutting it into slices at each doubled quote or CR.
    let parts = null;
    let seg = pos + 1;
    let p = pos + 1;
    let closedAt = -1;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 34) {
        if (text.charCodeAt(p + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(seg, p), '"');
          p += 2;
          seg = p;
          continue;
        }
        closedAt = p;
        break;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (parts === null) parts = [];
        parts.push(text.slice(seg, p), '\n');
        line += 1;
        p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
        seg = p;
        continue;
      }
      if (c === 10) line += 1;
      p += 1;
    }
    if (closedAt === -1) {
      // Reached the end without closing: same as the no-quote-found case.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    let value;
    if (parts === null) {
      value = text.slice(seg, closedAt);
    } else {
      parts.push(text.slice(seg, closedAt));
      value = parts.join('');
    }
    pos = closedAt + 1;
    if (pos >= n) return [value, END];
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return [value, COMMA];
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return [value, LINE_BREAK];
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return [value, LINE_BREAK];
    }
    const junk = readUnquoted(value);
    if (junk[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return [junk[0], junk[1]];
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record's line holds no quote and no stray CR, so the
    // record ends at the line break and its fields are one split apart. The
    // line is cut out once (a slice is a view, not a copy) and checked with
    // the engine's own search; a trailing CR of a CRLF break is left out.
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? n : nl;
    let contentEnd = end;
    if (nl !== -1 && end > pos && text.charCodeAt(end - 1) === 13) contentEnd = end - 1;
    const seg = text.slice(pos, contentEnd);
    let fields;
    let quoted = false;
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      fields = seg.split(',');
      pos = nl === -1 ? n : nl + 1;
      if (nl !== -1) line += 1;
    } else {
      // Slow path: the record holds a quote or a stray CR; read it field by
      // field, exactly as the reference does.
      fields = [];
      let field;
      do {
        quoted = text.charCodeAt(pos) === 34;
        field = quoted ? readQuoted() : readUnquoted('');
        fields.push(field[0]);
      } while (field[1] === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
