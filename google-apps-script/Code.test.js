import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./Code.gs", import.meta.url), "utf8");

class Range {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.valueAt(this.row + rowOffset, this.column + columnOffset),
      ),
    );
  }

  getValue() {
    return this.sheet.valueAt(this.row, this.column);
  }

  setValue(value) {
    this.sheet.setValue(this.row, this.column, value);
    return this;
  }

  setValues(values) {
    values.forEach((rowValues, rowOffset) =>
      rowValues.forEach((value, columnOffset) =>
        this.sheet.setValue(this.row + rowOffset, this.column + columnOffset, value),
      ),
    );
    return this;
  }

  setNumberFormat(format) {
    this.sheet.formats.set(`${this.row}:${this.column}`, format);
    return this;
  }
}

class Sheet {
  constructor(rows = []) {
    this.rows = rows.map((row) => [...row]);
    this.formats = new Map();
    this.failMajorMarkerOnce = false;
  }

  getLastRow() {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index].some((value) => value !== "" && value != null)) return index + 1;
    }
    return 0;
  }

  getLastColumn() {
    return Math.max(0, ...this.rows.map((row) => row.length));
  }

  getDataRange() {
    const width = Math.max(1, ...this.rows.map((row) => row.length));
    return this.getRange(1, 1, Math.max(1, this.getLastRow()), width);
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new Range(this, row, column, rowCount, columnCount);
  }

  appendRow(values) {
    this.rows.push([...values]);
  }

  valueAt(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? "";
  }

  setValue(row, column, value) {
    if (this.failMajorMarkerOnce && column === 11 && value === "major") {
      this.failMajorMarkerOnce = false;
      throw new Error("Simulated interruption during amount migration");
    }
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push("");
    this.rows[row - 1][column - 1] = value;
  }
}

function createAppsScript(transactions = new Sheet()) {
  const sheets = new Map([["Transactions", transactions]]);
  const spreadsheet = {
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = new Sheet();
      sheets.set(name, sheet);
      return sheet;
    },
  };
  const context = {
    SpreadsheetApp: {
      openById: () => spreadsheet,
      getActiveSpreadsheet: () => spreadsheet,
      newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }),
      getUi: () => ({ alert() {} }),
      BorderStyle: { SOLID: "SOLID" },
      DataValidationCriteria: { VALUE_IN_LIST: "VALUE_IN_LIST" },
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => "test-sheet-id" }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content) => ({
        content,
        setMimeType() { return this; },
        getContent() { return this.content; },
      }),
    },
    Utilities: {
      formatDate: (date) => date.toISOString().slice(0, 10),
    },
    Session: { getScriptTimeZone: () => "UTC" },
  };
  runInNewContext(source, context);
  return { api: context, transactions };
}

function response(output) {
  return JSON.parse(output.getContent());
}

function post(api, action, data) {
  return response(api.doPost({
    postData: { contents: JSON.stringify({ action, data }) },
  }));
}

function legacyRow(id, amountCents) {
  const date = "2026-01-15T12:00:00.000Z";
  return [id, "expense", amountCents, "Food", "Cafe", "", date, date, date, false];
}

describe("Google Sheets transaction amounts", () => {
  it("stores submitted amounts as currency units and reads them back unchanged", () => {
    const { api, transactions } = createAppsScript();
    const cases = [100, 500, 1500, 250.5];

    cases.forEach((amount, index) => {
      const result = post(api, "add_transaction", {
        id: `amount-${index}`,
        type: "expense",
        amount,
        category: "Food",
        source_destination: "Cafe",
        transaction_date: "2026-01-15T12:00:00.000Z",
      });
      expect(result.success).toBe(true);
      expect(result.data.transaction.amount).toBe(amount);
      expect(transactions.valueAt(index + 2, 3)).toBe(amount);
      expect(transactions.valueAt(index + 2, 11)).toBe("major");
      expect(transactions.formats.get(`${index + 2}:3`)).toBe("0.00");
    });

    const snapshot = response(api.doGet({ parameter: { action: "get_snapshot" } }));
    expect(snapshot.data.transactions.map((transaction) => transaction.amount)).toEqual(cases);
    const invalidPrecision = post(api, "add_transaction", {
      id: "amount-extra-precision",
      type: "expense",
      amount: 100.005,
      category: "Food",
      source_destination: "Cafe",
      transaction_date: "2026-01-15T12:00:00.000Z",
    });
    expect(invalidPrecision.success).toBe(false);
    expect(invalidPrecision.error.code).toBe("VALIDATION_ERROR");
    expect(transactions.getLastRow()).toBe(5);
  });

  it("updates decimal amounts idempotently and syncs soft deletions", () => {
    const { api, transactions } = createAppsScript();
    const add = post(api, "add_transaction", {
      id: "edited-amount",
      type: "expense",
      amount: 100,
      category: "Food",
      source_destination: "Cafe",
      transaction_date: "2026-01-15T12:00:00.000Z",
    });
    const expectedUpdatedAt = add.data.transaction.updated_at;
    const updateData = {
      ...add.data.transaction,
      amount: 250.5,
      expected_updated_at: expectedUpdatedAt,
    };

    expect(post(api, "update_transaction", updateData).data.transaction.amount).toBe(250.5);
    expect(post(api, "update_transaction", updateData).data.transaction.amount).toBe(250.5);
    expect(transactions.valueAt(2, 3)).toBe(250.5);

    const deletion = { id: "edited-amount", expected_updated_at: transactions.valueAt(2, 9) };
    expect(post(api, "delete_transaction", deletion).data.deleted).toBe(true);
    expect(post(api, "delete_transaction", deletion).data.deleted).toBe(true);
    expect(transactions.valueAt(2, 10)).toBe(true);
    expect(response(api.doGet({ parameter: { action: "get_snapshot" } })).data.transactions).toEqual([]);
  });

  it("migrates existing cent values once and safely resumes an interrupted row", () => {
    const transactions = new Sheet([
      ["id", "type", "amount", "category", "source_destination", "description", "transaction_date", "created_at", "updated_at", "deleted"],
      legacyRow("legacy-100", 10_000),
      legacyRow("legacy-500", 50_000),
      legacyRow("legacy-1500", 150_000),
      legacyRow("legacy-decimal", 25_050),
    ]);
    transactions.failMajorMarkerOnce = true;
    const { api } = createAppsScript(transactions);

    const interrupted = response(api.doGet({ parameter: { action: "get_snapshot" } }));
    expect(interrupted.success).toBe(false);
    expect(transactions.valueAt(2, 3)).toBe(100);
    expect(transactions.valueAt(2, 11)).toBe("migrating:10000");

    const migrated = response(api.doGet({ parameter: { action: "get_snapshot" } }));
    expect(migrated.success).toBe(true);
    expect(migrated.data.transactions.map((transaction) => transaction.amount)).toEqual([100, 500, 1500, 250.5]);
    expect(transactions.valueAt(5, 3)).toBe(250.5);
    expect(transactions.rows.slice(1).map((row) => row[10])).toEqual(["major", "major", "major", "major"]);

    const repeated = response(api.doGet({ parameter: { action: "get_snapshot" } }));
    expect(repeated.data.transactions.map((transaction) => transaction.amount)).toEqual([100, 500, 1500, 250.5]);
  });

  it("appends its migration marker without overwriting existing custom columns", () => {
    const transactions = new Sheet([
      ["id", "type", "amount", "category", "source_destination", "description", "transaction_date", "created_at", "updated_at", "deleted", "existing_note"],
      [...legacyRow("with-extra-column", 12_345), "keep this value"],
    ]);
    const { api } = createAppsScript(transactions);

    const snapshot = response(api.doGet({ parameter: { action: "get_snapshot" } }));
    expect(snapshot.data.transactions[0].amount).toBe(123.45);
    expect(transactions.valueAt(2, 11)).toBe("keep this value");
    expect(transactions.valueAt(2, 12)).toBe("major");
  });
});
