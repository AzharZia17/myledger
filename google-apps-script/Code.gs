const TRANSACTION_HEADERS = ['id','type','amount','category','source_destination','description','transaction_date','created_at','updated_at','deleted'];
const SETTINGS_HEADERS = ['key','value'];

function doGet(e) {
  return respond(function() {
    const action = e && e.parameter ? e.parameter.action : 'get_dashboard';
    if (action === 'get_dashboard') return getDashboard();
    if (action === 'get_transactions') return getTransactions();
    if (action === 'get_settings') return getSettings();
    if (action === 'get_snapshot') return getSnapshot();
    throw error('INVALID_ACTION', 'Unknown API action');
  });
}

function doPost(e) {
  return respond(function() {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const body = JSON.parse(e.postData.contents);
      const action = body.action;
      const data = body.data || {};
      if (action === 'add_transaction') return addTransaction(data);
      if (action === 'update_transaction') return updateTransaction(data);
      if (action === 'delete_transaction') return deleteTransaction(data);
      if (action === 'update_settings') return updateSettings(data);
      throw error('INVALID_ACTION', 'Unknown API action');
    } finally { lock.releaseLock(); }
  });
}

function respond(fn) {
  try { return json({success:true,data:fn(),error:null}); }
  catch (e) {
    const apiError = e && e.code ? e : error('INTERNAL_ERROR','Unable to complete the request');
    return json({success:false,data:null,error:{code:apiError.code,message:apiError.message}});
  }
}

function error(code, message) { const e = new Error(message); e.code = code; return e; }
function json(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

function spreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw error('CONFIG_ERROR','SPREADSHEET_ID is not configured');
  const ss = SpreadsheetApp.openById(id);
  let transactions = ss.getSheetByName('Transactions');
  let settings = ss.getSheetByName('Settings');
  if (!transactions) { transactions = ss.insertSheet('Transactions'); transactions.appendRow(TRANSACTION_HEADERS); }
  else ensureHeaders(transactions, TRANSACTION_HEADERS);
  if (!settings) { settings = ss.insertSheet('Settings'); settings.appendRow(SETTINGS_HEADERS); }
  else ensureHeaders(settings, SETTINGS_HEADERS);
  initializeSettings(settings);
  return {ss:ss, transactions:transactions, settings:settings};
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) { sheet.appendRow(headers); return; }
  const existing = sheet.getRange(1,1,1,headers.length).getValues()[0];
  for (let i=0;i<headers.length;i++) if (!existing[i]) sheet.getRange(1,i+1).setValue(headers[i]);
}

function initializeSettings(sheet) {
  const values = sheet.getDataRange().getValues();
  const keys = {};
  for (let i=1;i<values.length;i++) keys[String(values[i][0])] = i+1;
  [['opening_balance','0'],['currency','PKR'],['app_name','My Ledger']].forEach(function(row) {
    if (!keys[row[0]]) sheet.appendRow(row);
  });
}

function getSettings() {
  const sheets = spreadsheet();
  return readSettings(sheets.settings);
}

function readSettings(sheet) {
  const map = settingsMap(sheet);
  return {
    opening_balance: centsToNumber(map.opening_balance || '0'),
    currency: map.currency || 'PKR',
    app_name: map.app_name || 'My Ledger',
    theme: map.theme || 'system'
  };
}

function settingsMap(sheet) {
  const values = sheet.getDataRange().getValues();
  const map = {};
  for (let i=1;i<values.length;i++) if (values[i][0]) map[String(values[i][0])] = String(values[i][1]);
  return map;
}

function setSetting(sheet, key, value) {
  const values = sheet.getDataRange().getValues();
  for (let i=1;i<values.length;i++) if (String(values[i][0]) === key) { sheet.getRange(i+1,2).setValue(String(value)); return; }
  sheet.appendRow([key,String(value)]);
}

function updateSettings(data) {
  const sheets = spreadsheet();
  if (typeof data.opening_balance !== 'number' && typeof data.opening_balance !== 'string') throw error('VALIDATION_ERROR','Invalid opening balance');
  const opening = Number(data.opening_balance);
  if (!isFinite(opening)) throw error('VALIDATION_ERROR','Invalid opening balance');
  setSetting(sheets.settings,'opening_balance',numberToCents(opening));
  setSetting(sheets.settings,'currency','PKR');
  setSetting(sheets.settings,'app_name',String(data.app_name || 'My Ledger').slice(0,100));
  setSetting(sheets.settings,'theme',['light','dark','system'].includes(data.theme) ? data.theme : 'system');
  return getSettings();
}

function readTransactions(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2,1,sheet.getLastRow()-1,TRANSACTION_HEADERS.length).getValues();
  return rows.map(function(row){
    const deleted = String(row[9]).toLowerCase() === 'true';
    return {id:String(row[0]),type:String(row[1]),amount:centsToNumber(row[2]),category:String(row[3]||''),source_destination:String(row[4]||''),description:String(row[5]||''),transaction_date:normalizeDate(row[6]),created_at:normalizeDate(row[7]),updated_at:normalizeDate(row[8]),deleted:deleted};
  }).filter(function(row){return row.id && !row.deleted;});
}

function normalizeDate(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value || '');
  if (!text) return '';
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function numberToCents(value) { return Math.round(Number(value) * 100); }
function centsToNumber(value) { return Number(value || 0) / 100; }

function getTransactions() {
  const sheets = spreadsheet();
  const transactions = readTransactions(sheets.transactions).sort(function(a,b){return new Date(b.transaction_date).getTime()-new Date(a.transaction_date).getTime();});
  return {transactions:transactions};
}

function getDashboard() {
  const sheets = spreadsheet();
  const settings = readSettings(sheets.settings);
  const transactions = readTransactions(sheets.transactions);
  let incomeCents = 0, expenseCents = 0;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const month = today.slice(0,7);
  let incomeToday = 0, expenseToday = 0, expenseMonth = 0;
  transactions.forEach(function(t) {
    const cents = numberToCents(t.amount);
    if (t.type === 'income') incomeCents += cents; else if (t.type === 'expense') expenseCents += cents;
    const dateText = normalizeDate(t.transaction_date).slice(0,10);
    if (dateText === today) { if (t.type === 'income') incomeToday += cents; if (t.type === 'expense') expenseToday += cents; }
    if (dateText.slice(0,7) === month && t.type === 'expense') expenseMonth += cents;
  });
  const openingCents = numberToCents(settings.opening_balance);
  transactions.sort(function(a,b){return new Date(b.transaction_date).getTime()-new Date(a.transaction_date).getTime();});
  return {balance:centsToNumber(openingCents+incomeCents-expenseCents),opening_balance:settings.opening_balance,income_today:centsToNumber(incomeToday),expense_today:centsToNumber(expenseToday),expense_month:centsToNumber(expenseMonth),recent_transactions:transactions.slice(0,10),settings:settings};
}

function getSnapshot() {
  const sheets = spreadsheet();
  return {
    transactions: readTransactions(sheets.transactions).sort(function(a,b) {
      return new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime();
    }),
    settings: readSettings(sheets.settings)
  };
}

function validateTransaction(data) {
  if (!data.id || typeof data.id !== 'string' || data.id.length > 100) throw error('VALIDATION_ERROR','Invalid transaction ID');
  if (data.type !== 'income' && data.type !== 'expense') throw error('VALIDATION_ERROR','Invalid transaction type');
  const amount = Number(data.amount);
  if (!isFinite(amount) || amount <= 0) throw error('VALIDATION_ERROR','Invalid amount');
  if (data.type === 'income' && !String(data.source_destination || '').trim()) throw error('VALIDATION_ERROR','Source is required');
  if (!data.transaction_date || isNaN(new Date(data.transaction_date).getTime())) throw error('VALIDATION_ERROR','Invalid transaction date');
  return amount;
}

function findTransactionRow(sheet, id) {
  if (sheet.getLastRow() < 2) return -1;
  const ids = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues();
  for (let i=0;i<ids.length;i++) if (String(ids[i][0]) === String(id)) return i+2;
  return -1;
}

function addTransaction(data) {
  const sheets = spreadsheet();
  const amount = validateTransaction(data);
  const existingRow = findTransactionRow(sheets.transactions,data.id);
  if (existingRow !== -1) {
    const raw = sheets.transactions.getRange(existingRow,1,1,TRANSACTION_HEADERS.length).getValues()[0];
    if (String(raw[9]).toLowerCase() === 'true') throw error('CONFLICT','A deleted transaction cannot be recreated with the same ID');
    const existing = readTransactions(sheets.transactions).filter(function(t){return t.id === data.id})[0];
    const same = existing && existing.type === data.type &&
      numberToCents(existing.amount) === numberToCents(amount) &&
      existing.category === String(data.category||'') &&
      existing.source_destination === String(data.source_destination||'') &&
      existing.description === String(data.description||'') &&
      existing.transaction_date === new Date(data.transaction_date).toISOString();
    if (same) return {transaction:existing,balance:getDashboard().balance};
    throw error('CONFLICT','This transaction ID already belongs to different data');
  }
  const now = new Date().toISOString();
  const transaction = {id:String(data.id),type:data.type,amount:amount,category:String(data.category||''),source_destination:String(data.source_destination||''),description:String(data.description||''),transaction_date:new Date(data.transaction_date).toISOString(),created_at:now,updated_at:now,deleted:false};
  sheets.transactions.appendRow([transaction.id,transaction.type,numberToCents(amount),transaction.category,transaction.source_destination,transaction.description,transaction.transaction_date,transaction.created_at,transaction.updated_at,false]);
  return {transaction:transaction,balance:getDashboard().balance};
}

function updateTransaction(data) {
  const sheets = spreadsheet();
  if (!data.id) throw error('VALIDATION_ERROR','Invalid transaction ID');
  const amount = validateTransaction(data);
  const row = findTransactionRow(sheets.transactions,data.id);
  if (row === -1) throw error('NOT_FOUND','Transaction not found');
  const currentValues = sheets.transactions.getRange(row,1,1,TRANSACTION_HEADERS.length).getValues()[0];
  if (String(currentValues[9]).toLowerCase() === 'true') throw error('NOT_FOUND','Transaction has already been deleted');
  const current = readTransactions(sheets.transactions).filter(function(t){return t.id===data.id})[0];
  const desiredDate = new Date(data.transaction_date).toISOString();
  const desired = {
    type:data.type,
    amount:numberToCents(amount),
    category:String(data.category||''),
    source_destination:String(data.source_destination||''),
    description:String(data.description||''),
    transaction_date:desiredDate
  };
  const isAlreadyApplied = current && current.type === desired.type &&
    numberToCents(current.amount) === desired.amount &&
    current.category === desired.category &&
    current.source_destination === desired.source_destination &&
    current.description === desired.description &&
    current.transaction_date === desired.transaction_date;
  if (isAlreadyApplied) return {transaction:current,balance:getDashboard().balance};
  const currentUpdatedAt = normalizeDate(currentValues[8]);
  if (!data.expected_updated_at || normalizeDate(data.expected_updated_at) !== currentUpdatedAt) {
    throw error('CONFLICT','This transaction changed elsewhere. Your local edit is preserved; review it before retrying.');
  }
  const now = new Date().toISOString();
  sheets.transactions.getRange(row,2,1,9).setValues([[desired.type,desired.amount,desired.category,desired.source_destination,desired.description,desired.transaction_date,sheets.transactions.getRange(row,8).getValue(),now,false]]);
  return {transaction:readTransactions(sheets.transactions).filter(function(t){return t.id===data.id})[0] || null,balance:getDashboard().balance};
}

function deleteTransaction(data) {
  const sheets = spreadsheet();
  if (!data.id) throw error('VALIDATION_ERROR','Invalid transaction ID');
  const row = findTransactionRow(sheets.transactions,data.id);
  if (row === -1) return {deleted:true,balance:getDashboard().balance};
  const currentValues = sheets.transactions.getRange(row,1,1,TRANSACTION_HEADERS.length).getValues()[0];
  if (String(currentValues[9]).toLowerCase() === 'true') return {deleted:true,balance:getDashboard().balance};
  const currentUpdatedAt = normalizeDate(currentValues[8]);
  if (!data.expected_updated_at || normalizeDate(data.expected_updated_at) !== currentUpdatedAt) {
    throw error('CONFLICT','This transaction changed elsewhere. It was not deleted.');
  }
  sheets.transactions.getRange(row,10).setValue(true);
  sheets.transactions.getRange(row,9).setValue(new Date().toISOString());
  return {deleted:true,balance:getDashboard().balance};
}
