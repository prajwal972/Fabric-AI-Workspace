import pg from "pg";
import { AppError } from "../server/errors.mjs";
const scalarTypes = new Set([
  16, 17, 18, 19, 20, 21, 23, 25, 26, 114, 700, 701, 790, 1042, 1043, 1082,
  1083, 1114, 1184, 1186, 1266, 1700, 2950, 3802,
]);
const arrayTypes = new Set([
  1000, 1001, 1002, 1003, 1005, 1007, 1009, 1014, 1015, 1016, 1021, 1022, 1115,
  1182, 1183, 1185, 1187, 1231, 1270, 199, 2951, 3807,
]);
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
export function boundedSQLProjection(query, fields) {
  if (
    !fields.length ||
    fields.length > 50 ||
    new Set(fields.map((f) => f.name)).size !== fields.length
  )
    throw new AppError(
      "SQL_OUTPUT_SCHEMA",
      "Select at most 50 uniquely named columns; use explicit aliases.",
      400,
    );
  if (
    fields.some(
      (f) => !scalarTypes.has(f.dataTypeID) && !arrayTypes.has(f.dataTypeID),
    )
  )
    throw new AppError(
      "SQL_UNSUPPORTED_TYPE",
      "The analytics output uses an unsupported custom type.",
      400,
    );
  const pairs = fields
    .flatMap((f) => [
      literal(f.name),
      `fabric_result.${identifier(f.name)}::text`,
    ])
    .join(",");
  // Size is checked on the server *before* the row payload crosses the wire.
  // Values are text so pg's original OID parser preserves bigint/numeric precision.
  return `SELECT CASE WHEN octet_length(payload::text)<=10000 THEN payload ELSE NULL END AS payload FROM (SELECT json_build_object(${pairs}) AS payload FROM (${query}) AS fabric_result LIMIT 100) AS fabric_encoded`;
}
export function decodeSQLRows(rows, fields) {
  if (rows.some((row) => row.payload === null))
    throw new AppError(
      "SQL_OUTPUT_LIMIT",
      "A query row exceeded its byte limit. Select fewer or smaller values.",
      422,
    );
  const output = rows.map(({ payload }) =>
    Object.fromEntries(
      fields.map((field) => [
        field.name,
        payload[field.name] === null
          ? null
          : pg.types.getTypeParser(
              field.dataTypeID,
              "text",
            )(payload[field.name]),
      ]),
    ),
  );
  if (Buffer.byteLength(JSON.stringify(output)) > 100000)
    throw new AppError(
      "SQL_OUTPUT_LIMIT",
      "The query result exceeded its byte limit.",
      422,
    );
  return output;
}
