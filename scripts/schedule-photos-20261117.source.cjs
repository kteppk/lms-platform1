// Transcription of the user's photographs. null = fully visible empty cell;
// {unknown: ...} = unreadable/cropped cell, which must not become "Нет пары".
const teachers={
 A:'Аракчаа С.Ю.',B:'Бурбу Ч.М.',M:'Монгуш А.Б.',O:'Ондар С.А.',N:'Ондар А.А.',D:'Дадар Ч.Ч.',E:'Гузик Т.А.',F:'Донгак С.А.',
 G:{guess:'Ховалыгмаа М.А.',question:'Уточнить написание фамилии преподавателя географии.'},
 S:{guess:'Амр-Санаа Н.А.',question:'Уточнить написание фамилии преподавателя истории/обществознания (на фото читается как «Амр-Санаа Н.А.»).'},
 X:{guess:'Мижит-Доржу О.С.',question:'Уточнить фамилию преподавателя иностранного языка (читается как «Мижит-Доржу О.С.»).'},
 H:'Ооржак Ш.С.',C:'Тюлюш С.Л.',
 DA:'Донгак А.А.',DC:'Донгак Д.С.',BJ:'Донгак А-К.А.',DP:'Дапык С.М.',IT:'Шыыран С.О.',EN:'Шыыран Р.А.',PH:'Биче-оол М.Б.',NB:'Ооржак Н.Б.',DOC:'Ооржак А.Ч.',
 AUTO:{guess:'О.П. (фамилия неразборчива)',question:'Уточнить фамилию преподавателя автоматизации/цифрового бухгалтерского учёта, инициалы О.П., фото 6.'},
 BANK:{guess:'Шапаа А.А.',question:'Уточнить фамилию преподавателя основ банковского дела, фото 7.'},
 KP:'Каштак В.В.',KL:'Куулар Л.В.',KA:'Кыргыс К.А.',MA:'Монгуш А.С.',VS:'Базыр В.С.',
 RS:{guess:'Панатова Р.С.',question:'Уточнить фамилию преподавателя уголовного, уголовно-процессуального и гражданского права, инициалы Р.С., фото 8–10.'}
};
const subjects={lit:'Литература',rus:'Русский язык',ob:'ОБЗР',mat:'Математика',law:'Право',geo:'География',his:'История',soc:'Обществознание',eco:'Экономика',fam:'Школа счастливой семьи',eng:'Иностранный язык',chem:'Химия',
 stat:'Статистика',it:'Информационные технологии в профессиональной деятельности',psy:'Психология общения',org:'Экономика организации',ph:'Основы философии',en:'Иностранный язык в профессиональной деятельности',account:'Основы бухгалтерского учёта',history:'История России',analysis:'Анализ финансово-хозяйственной деятельности',lean:'Основы бережливого производства',bjd:'Безопасность жизнедеятельности',doc:'Документационное обеспечение управления',coop:'Основы организации кооперативного бизнеса',budget:'Организация расчётов с бюджетами бюджетной системы Российской Федерации',report:'Технология составления бухгалтерской отчётности',auto:'Автоматизация бухгалтерского учёта в «1С:Бухгалтерия»',assets:'Практические основы бухгалтерского учёта активов организации и источников их формирования',reportAnalysis:'Основы анализа бухгалтерской отчётности',digital:'Бухгалтерский учёт с применением цифровых технологий',
 accounting:'Бухгалтерский учёт',cashless:'Организация безналичных расчётов',finance:'Финансы организации',management:'Менеджмент',bank:'Основы банковского дела',cash:'Кассовые операции банка',credit:'Учёт кредитных операций банка',entre:'Основы предпринимательской деятельности',creditOrg:'Организация кредитной работы',bankDoc:'Документационное обеспечение профессиональной деятельности',agent:'Технология выполнения работ по должности служащего «Агент банка»',
 initial:'Начальная профессиональная подготовка и введение в специальность',constitutional:'Конституционное право России',criminal:'Уголовное право',theory:'Теория государства и права',admin:'Административное право',intro:'Введение в специальность — общие компетенции профессионала',tactic:'Тактико-специальная подготовка',business:'Основы предпринимательства',process:'Уголовно-процессуальное право',labor:'Трудовое право',criminology:'Криминология',special:'Специальная техника',fire:'Огневая подготовка',civil:'Гражданское право и гражданский процесс',crime:'Криминалистика',market:'Эффективное поведение на рынке труда',lawManagement:'Основы управления в правоохранительных органах'};
const lesson=(title,t,room,note='')=>({title:subjects[title]||title,teacher:t,room:room===null?'':String(room),note});
const l=lesson,U=why=>({unknown:why});
const day=(...cells)=>{while(cells.length<6)cells.push(null);return cells;};
const school='Социально-экономический профиль (на базе основного общего образования, 9 классов)';
const groups=[
 {name:'Н 9-01',course:'',program:school,photos:[1,2],days:[
 day(l('lit','A',29),l('ob','M',29),l('mat','B',29),l('law','O',29)),
 day(l('geo','G',29),l('his','H',29),l('mat','B',29)),
 day(l('rus','A',29),l('geo','G',29),l('soc','S',29)),
 day(l('soc','S',29),l('eco','E',17),l('law','O',29)),
 day(l('ob','M',29),l('mat','B',29),l('soc','S',17),l('fam','D',29)),
 day(l('ob','M',29),l('his','H',29),l('eng','X',29))]},
 {name:'Н 9-02',course:'',program:school,photos:[1,2],days:[
 day(l('mat','B',34),l('lit','A',34),l('ob','M',34)),
 day(l('law','O',34),l('geo','G',34),l('soc','S',34)),
 day(l('mat','B',34),l('rus','A',34),l('ob','M',34),l('geo','G',34)),
 day(l('his','H',34),l('eco','E',17),l('ob','M',34),l('soc','S',34)),
 day(l('law','O',34),l('eng','X',34),l('soc','S',17)),
 day(l('mat','B',34),l('fam','D',34),l('his','H',34))]},
 {name:'Н 9-03',course:'',program:school,photos:[3],days:[
 day(l('law','O',25),l('mat','B',25),l('lit','A',25),l('ob','M',25)),
 day(l('his','H',25),l('soc','S',25),l('geo','G',25)),
 day(l('law','O',25),l('mat','B',25),l('rus','A',25),l('soc','S',25)),
 day(l('geo','G',25),l('mat','B',25),l('eco','E',25)),
 day(l('his','H',25),l('ob','M',25),l('eng','F',25)),
 day(l('fam','D',25),l('ob','M',25),l('soc','S',25))]},
 {name:'Н 9-04',course:'',program:school,photos:[3],days:[
 day(l('ob','M',26),l('law','O',26),l('soc','S',26),l('lit','A',26)),
 day(l('his','S',26),l('mat','B',26),l('ob','M',26),l('fam','D',26)),
 day(l('geo','G',26),l('his','S',26),l('eco','E',17)),
 day(l('law','O',26),l('ob','M',26),l('rus','A',26)),
 day(l('geo','G',26),l('soc','S',17),l('mat','B',26)),
 day(l('soc','S',17),l('mat','B',26),l('eng','F',26))]},
 {name:'Н 9-05',course:'',program:school,photos:[4],days:[
 day(l('mat','N',30),l('eng','F',30),l('geo','G',30),l('his','S',33)),
 day(l('ob','M',30),l('lit','A',30),l('mat','N',30)),
 day(l('mat','N',30),l('law','O',30),l('eco','E',17),l('rus','A',30)),
 day(l('ob','M',30),l('soc','S',30),l('geo','G',30)),
 day(l('mat','N',30),l('soc','S',17),l('ob','M',30),l('his','S',30)),
 day(l('soc','S',17),l('law','O',33),l('fam','D',33),null,null,U('Нижняя часть шестой пары обрезана на фото 4.'))]},
 {name:'Н 9-06',course:'',program:school,photos:[4],days:[
 day(l('geo','G',33),l('mat','N',33),l('law','O',33)),
 day(l('chem','C',33),l('law','O',33),l('lit','A',33)),
 day(l('his','S',33),l('eco','E',17),l('mat','N',33),l('fam','D',33)),
 day(l('eco','E',17),l('geo','G',33),l('his','S',33),l('mat','N',33)),
 day(l('soc','S',17),l('chem','C',33),l('rus','A',33)),
 day(l('eng','F',33),l('soc','S',17),null,null,null,U('Нижняя часть шестой пары обрезана на фото 4.'))]},
 {name:'Н 9-07',course:'',program:school,photos:[5],days:[
 day(l('his','S',27),l('geo','G',27),l('mat','N',27)),
 day(l('lit','A',28),l('mat','N',27),l('eng','F',28),l('his','S',24)),
 day(l('chem','C',27),l('eco','E',17),l('geo','G',30)),
 day(l('eco','E',17),l('mat','N',34),l('chem','C',27),l('fam','D',24)),
 day(l('soc','S',17),l('rus','A',30),l('law','O',34)),
 day(l('law','O',30),l('soc','S',17),null,null,U('Низ субботы обрезан на фото 5.'),U('Низ субботы обрезан на фото 5.'))]},
 {name:'Н 9-08',course:'',program:school,photos:[5],days:[
 day(l('chem','C',24),l('his','S',24),l('eco','E',24),l('fam','D',24)),
 day(l('mat','N',24),l('ob','M',24),l('eco','E',24),l('geo','G',null,'Уточнить аудиторию: блик на фото 5, вторник, 4 пара.')),
 day(l('ob','M',24),l('mat','N',24),l('law','O',24)),
 day(l('mat','N',24),l('law','O',24),l('eng','F',24)),
 day(l('lit','A',24),l('mat','N',24),l('geo','G',24),l('rus','A',24)),
 day(null,null,l('chem','C',24),l('his','S',24),U('Низ субботы обрезан на фото 5.'),U('Низ субботы обрезан на фото 5.'))]}
];
const accounting='38.02.01 Экономика и бухгалтерский учёт',banking='38.02.07 Банковское дело',police='41.02.02 Правоохранительная деятельность';
groups.push(
 {name:'1261',course:'1',program:accounting,photos:[6],days:[
 day(l('stat','DA',7),l('it','IT',12),l('psy','D',35)),
 day(null,null,null,l('org','E',35),l('ph','PH',13),l('en','X',35)),
 day(l('account','DP',7),l('history','H',35),l('analysis','DP',26),l('it','IT',12)),
 day(l('ph','PH',7),l('lean','NB',13),l('account','DP',35),l('org','E',7)),
 day(l('analysis','DP',7),l('ph','PH',35),l('account','DP',13),l('bjd','BJ',27)),
 day(l('doc','DOC',7),l('bjd','BJ',7))]},
 {name:'1251',course:'2',program:accounting,photos:[6],days:[
 day(null,l('coop','DA',7),l('budget','DP',7),l('en','EN',7),l('budget','DP',7),l('report','DP',7)),
 day(null,l('auto','AUTO',7),l('auto','AUTO',7),l('assets','DP',7),l('reportAnalysis','DP',7),l('report','DP',7)),
 day(null,l('auto','AUTO',7),l('auto','AUTO',7),l('assets','DP',7),l('reportAnalysis','DP',7),l('coop','DA',7)),
 day(null,l('auto','AUTO',7),l('auto','AUTO',7),l('report','DP',25),l('budget','DP',7),l('report','DP',7)),
 day(null,l('digital','AUTO',7),l('digital','AUTO',7),l('report','DP',7),l('budget','DP',7),l('reportAnalysis','DP',7)),
 day()]},
 {name:'6261',course:'1',program:banking,photos:[7],days:[
 day(l('accounting','DP',14),l('bjd','BJ',14),l('cashless','DC',14)),
 day(l('accounting','DP',7),l('finance','DC',14),l('en','EN',9),l('history','H',25,'Аудитория 25 вписана от руки на фото 7.')),
 day(l('cashless','DC',14),l('bjd','BJ',14),l('management','NB',14)),
 day(l('bank','BANK',14),l('cashless','DC',14),l('finance','DC',14)),
 day(l('cash','DC',14),l('bank','BANK',14),l('management','NB',14)),
 day(l('history','H',14),l('cash','DC',14),null,null,null,U('Низ шестой пары обрезан на фото 7.'))]},
 {name:'6251',course:'2',program:banking,photos:[7],days:[
 day(null,null,null,l('lean','NB',14),l('credit','DC',14),l('en','EN',9)),
 day(null,null,null,l('entre','DA',14),l('creditOrg','DC',14),l('creditOrg','DC',14)),
 day(null,null,null,l('creditOrg','DC',14),l('lean','NB',14),l('bankDoc','DOC',14)),
 day(null,null,null,l('agent','DA',14),l('credit','DC',14),l('credit','DC',14)),
 day(null,null,null,l('agent','DA',14),l('agent','DA',14),l('creditOrg','DC',14)),
 day(l('creditOrg','DC',9),l('entre','DA',28),l('credit','DC',14),null,null,U('Низ шестой пары обрезан на фото 7.'))]},
 {name:'3261',course:'1',program:police,photos:[8],days:[
 day(l('initial','KP',28),l('constitutional','KL',28),l('criminal','RS',28)),
 day(null,null,l('criminal','RS',14),l('theory','MA',28),l('initial','KP',31),l('history','S',28)),
 day(l('initial','KP',31),l('criminal','RS',28),l('en','EN',28)),
 day(null,null,null,l('constitutional','KL',26),l('history','S',26),l('admin','KA',33)),
 day(l('admin','KA',28),l('theory','MA',28),l('intro','RS',28),l('initial','KP',28)),
 day(l('theory','MA',28),l('admin','KA',31),l('constitutional','KL',28),null,U('Низ субботы обрезан на фото 8.'),U('Низ субботы обрезан на фото 8.'))]},
 {name:'3262',course:'1',program:police,photos:[8],days:[
 day(l('criminal','RS',31),l('en','EN',31),l('initial','KP',31)),
 day(U('Блик закрывает первую пару во вторник на фото 8.'),null,l('theory','MA',31),l('criminal','RS',29),l('history','S',25),l('initial','KP',31)),
 day(null,null,null,l('initial','KP',26),l('history','S',31),l('admin','KA',31)),
 day(l('constitutional','KL',31),l('admin','KA',31),l('intro','RS',31)),
 day(l('theory','MA',31),l('criminal','RS',31),l('constitutional','KL',31)),
 day(l('initial','KP',31),l('constitutional','KL',9),l('admin','KA',35),l('theory','MA',31),U('Низ субботы обрезан на фото 8.'),U('Низ субботы обрезан на фото 8.'))]},
 {name:'3251',course:'1',program:police,photos:[9],courseQuestion:'На фото 9 напечатан 1 курс. Подтвердите актуальный курс группы 3251.',days:[
 day(null,null,null,l('tactic','KP',34),l('business','DA',30),l('process','RS',30)),
 day(null,null,null,l('tactic','KP',34),l('process','RS',30),l('labor','O',30)),
 day(null,null,null,l('labor','O',31),l('criminology','KL',30),l('special','VS',27)),
 day(null,null,null,l('tactic','KP',17),l('business','DA',30),l('tactic','KP',30)),
 day(null,null,null,l('en','EN',9),l('labor','O',26),l('civil','RS',30)),
 day(l('special','VS',22),l('fire','VS',1),l('labor','O',17),l('labor','O',17))]},
 {name:'3252',course:'1',program:police,photos:[9],courseQuestion:'На фото 9 напечатан 1 курс. Подтвердите актуальный курс группы 3252.',days:[
 day(null,null,null,l('special','VS',31),l('process','RS',31),l('tactic','KP',31)),
 day(U('Блик закрывает первую пару во вторник на фото 9.'),U('Блик закрывает вторую пару во вторник на фото 9.'),U('Блик закрывает третью пару во вторник на фото 9.'),l('labor','O',31),l('business','DA',26),l('special','VS',26)),
 day(l('criminology','KL',28),l('tactic','KP',null,'Уточнить аудиторию: блик на фото 9, среда, 2 пара.'),l('process','RS',null,'Уточнить аудиторию: блик на фото 9, среда, 3 пара.'),l('fire','VS',1)),
 day(null,null,null,l('tactic','KP',17),l('labor','O',31),l('business','DA',31)),
 day(null,null,l('en','EN',9),l('labor','O',31),l('civil','RS',31),l('tactic','KP',31)),
 day(null,null,l('labor','O',17),l('labor','O',17))]},
 {name:'3241',course:'2',program:police,photos:[10],courseQuestion:'На фото 10 напечатан 2 курс. Подтвердите актуальный курс группы 3241.',days:[
 day(null,null,null,l('process','RS',28),l('crime','KL',28),l('business','DA',28)),
 day(null,null,null,l('bjd','M',27),l('market','NB',28),l('crime','KL',13)),
 day(null,null,null,l('crime','KL',27),l('bjd','M',28),l('en','EN',9)),
 day(l('process','RS',28),l('crime','KL',27),l('crime','KL',17)),
 day(null,null,null,l('process','RS',13),l('lawManagement','KP',28),l('crime','KL',34)),
 day(null,l('lawManagement','KP',12),l('bjd','M',30),l('crime','KL',34),l('crime','KL',12))]},
 {name:'3242',course:'2',program:police,photos:[10],courseQuestion:'На фото 10 напечатан 2 курс. Подтвердите актуальный курс группы 3242.',days:[
 day(null,null,null,l('crime','KL',35),l('market','NB',33),l('bjd',null,13,'Уточнить преподавателя: блик на фото 10, понедельник, 6 пара.')),
 day(U('Блик закрывает первую пару во вторник на фото 10.'),U('Блик закрывает вторую пару во вторник на фото 10.'),U('Блик закрывает третью пару во вторник на фото 10.'),l('crime','KL',33),l('bjd','M',null,'Уточнить аудиторию: блик на фото 10, вторник, 5 пара.'),l('process','RS',33)),
 day(null,null,null,l('crime','KL',27),l('business','DA',33),l('process','RS',33)),
 day(l('en','EN',9),l('crime','KL',27),l('crime','KL',17)),
 day(null,null,null,l('crime','KL',33),l('bjd','M',13),l('crime','KL',33)),
 day(l('crime','KL',12),l('process','RS',15),l('lawManagement','KP',12),l('lawManagement','KP',12))]}
);
module.exports={teachers,groups,lesson,day,unknown:U};
