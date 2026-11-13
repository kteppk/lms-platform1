// A single-sheet OOXML workbook. Text uses inlineStr, never Excel formulas.
const ResultsExport = (() => {
  const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const date=value=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'}):'—';
  const scaleLabel=scale=>scale?`Оценка 3: от ${scale.min_three}%; 4: от ${scale.min_four}%; 5: от ${scale.min_five}%. Шкала, версия ${scale.revision+1}.`:'Шкала 2–5 не задана. Представлены баллы и проценты.';
  const labels=['№','ФИО студента','Попытка','Баллы','Максимум','Процент','Оценка','Статус','Сдано (Кызыл)','Проверено (Кызыл)'];
  const values=(row,i)=>[i+1,row.student_name,row.attempt_number,row.status==='graded'?row.score:null,row.total,
    row.status==='graded'&&row.total>0?row.score/row.total:null,row.mark,row.status==='graded'?'Проверено':'Ожидает проверки',date(row.submitted_at),row.graded_at?date(row.graded_at):''];
  const criteria=filters=>[
    filters.mode==='all'?'Все попытки':'Последняя попытка каждого студента',
    filters.studentName?'Поиск: '+filters.studentName:'',filters.studentId?'История одного студента':'',
    filters.status==='graded'?'Только проверенные':filters.status==='pending_review'?'Только ожидающие проверки':''
  ].filter(Boolean).join(' · ');
  const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xEDB88320^(n>>>1):n>>>1;return n>>>0;});
  function crc(bytes){let n=0xFFFFFFFF;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xFFFFFFFF)>>>0;}
  function zip(files){
    const encoder=new TextEncoder(),parts=[],central=[];let offset=0,centralSize=0;
    for(const [name,source] of Object.entries(files)){
      const filename=encoder.encode(name),bytes=encoder.encode(source),checksum=crc(bytes);
      const local=new Uint8Array(30+filename.length),v=new DataView(local.buffer);
      v.setUint32(0,0x04034B50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);
      v.setUint32(14,checksum,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,filename.length,true);local.set(filename,30);
      const directory=new Uint8Array(46+filename.length),d=new DataView(directory.buffer);
      d.setUint32(0,0x02014B50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);
      d.setUint32(16,checksum,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,filename.length,true);d.setUint32(42,offset,true);directory.set(filename,46);
      parts.push(local,bytes);central.push(directory);offset+=local.length+bytes.length;centralSize+=directory.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054B50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    return new Blob([...parts,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function workbook(data,filters){
    const excelDate=value=>value?(Date.parse(value)+7*3600000)/86400000+25569:null;
    const rows=[[data.test.title],[criteria(filters)],[scaleLabel(data.scale)],[`Сформировано: ${date(data.generatedAt)} · Время: Кызыл (UTC+7)`],labels,...data.rows.map((row,i)=>{
      const cells=values(row,i);cells[8]=excelDate(row.submitted_at);cells[9]=excelDate(row.graded_at);return cells;
    })];
    const headerRow=5,lastRow=rows.length;
    const sheet=rows.map((row,index)=>`<row r="${index+1}" ht="${index>4?45:32}" customHeight="1">${row.map((value,column)=>{
      const ref=String.fromCharCode(65+column)+(index+1),style=index===4?1:index>4&&column>=8?3:column===5&&index>4?2:0;
      if(value==null)return `<c r="${ref}" s="${style}"/>`;
      return typeof value==='number'&&Number.isFinite(value)?`<c r="${ref}" s="${style}"><v>${value}</v></c>`:
        `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    return zip({
      '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="workbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Результаты" sheetId="1" r:id="sheet1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'Результаты'!$5:$5</definedName></definedNames></workbook>`,
      'xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml':`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      'xl/worksheets/sheet1.xml':`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:J${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRow}" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/><col min="3" max="7" width="12" customWidth="1"/><col min="8" max="8" width="24" customWidth="1"/><col min="9" max="10" width="24" customWidth="1"/></cols><sheetData>${sheet}</sheetData><autoFilter ref="A5:J${lastRow}"/><mergeCells count="4">${[1,2,3,4].map(n=>`<mergeCell ref="A${n}:J${n}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`
    });
  }
  function printHtml(data,filters){
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${xml(data.test.title)}</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#111}h1{font-size:18px}p{line-height:1.5}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{border:1px solid #999;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#eee}thead{display:table-header-group}tr{break-inside:avoid}td:nth-child(2){min-width:130px}h1,p{overflow-wrap:anywhere}</style></head><body><h1>${xml(data.test.title)}</h1><p>${xml(criteria(filters))}<br>${xml(scaleLabel(data.scale))}<br>Сформировано: ${xml(date(data.generatedAt))} · Кызыл (UTC+7)</p><table><thead><tr>${labels.map(t=>`<th scope="col">${xml(t)}</th>`).join('')}</tr></thead><tbody>${data.rows.map((row,i)=>`<tr>${values(row,i).map((v,c)=>`<td>${v==null?'—':xml(c===5?(v*100).toLocaleString('ru-RU',{maximumFractionDigits:2})+'%':v)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  }
  function download(data,filters){
    const url=URL.createObjectURL(workbook(data,filters)),a=document.createElement('a');a.href=url;
    a.download='Результаты — '+data.test.title.replace(/[<>:"/\\|?*\u0000-\u001F]/g,' ').slice(0,80)+'.xlsx';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function print(data,filters){
    document.getElementById('resultsPrintFrame')?.remove();
    const frame=document.createElement('iframe');frame.id='resultsPrintFrame';frame.title='Печать результатов';frame.setAttribute('aria-hidden','true');
    frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0';
    const ready=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=()=>reject(new Error('Не удалось подготовить печать.'));});
    frame.srcdoc=printHtml(data,filters);document.body.append(frame);await ready;
    await frame.contentDocument.fonts.ready;frame.contentWindow.focus();frame.contentWindow.print();
  }
  return {workbook,printHtml,download,print,date,scaleLabel};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ResultsExport;
