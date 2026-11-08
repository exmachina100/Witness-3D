// Language (Plasticity: Preferences › General › Language: DE, EN, ES, IT, JA, RU, ZH, ZH-TW). The
// app's own words are English capitals written straight into its panels, so a language other than
// English is laid over them: every text node, tooltip and label whose whole text (or each part
// between " · ") is a known term shows that term's translation, and English comes back when the
// language is set to EN. Terms that are not in the table stay English. Pure lookups here; the
// page walking is at the end and only runs in a browser.

export const LANGUAGES = ['en', 'de', 'es', 'it', 'ja', 'ru', 'zh', 'zh-tw'];

// English term: [de, es, it, ja, ru, zh, zh-tw].
const T = {
    'OUTLINER': ['OUTLINER', 'ESQUEMA', 'STRUTTURA', 'アウトライナー', 'СТРУКТУРА', '大纲', '大綱'],
    'HISTORY': ['VERLAUF', 'HISTORIAL', 'CRONOLOGIA', '履歴', 'ИСТОРИЯ', '历史', '歷史'],
    'SOLIDS': ['VOLUMENKÖRPER', 'SÓLIDOS', 'SOLIDI', 'ソリッド', 'ТЕЛА', '实体', '實體'],
    'SHEETS': ['FLÄCHEN', 'LÁMINAS', 'SUPERFICI', 'シート', 'ЛИСТЫ', '片体', '片體'],
    'CURVES': ['KURVEN', 'CURVAS', 'CURVE', 'カーブ', 'КРИВЫЕ', '曲线', '曲線'],
    'CURVE': ['KURVE', 'CURVA', 'CURVA', 'カーブ', 'КРИВАЯ', '曲线', '曲線'],
    'SELECT': ['AUSWÄHLEN', 'SELECCIONAR', 'SELEZIONA', '選択', 'ВЫБОР', '选择', '選擇'],
    'SELECTED': ['AUSGEWÄHLT', 'SELECCIONADO', 'SELEZIONATO', '選択済み', 'ВЫБРАНО', '已选择', '已選擇'],
    'SELECTION': ['AUSWAHL', 'SELECCIÓN', 'SELEZIONE', '選択', 'ВЫДЕЛЕНИЕ', '选择', '選擇'],
    'F SEARCH': ['F SUCHEN', 'F BUSCAR', 'F CERCA', 'F 検索', 'F ПОИСК', 'F 搜索', 'F 搜尋'],
    'SEARCH COMMANDS': ['BEFEHLE SUCHEN', 'BUSCAR COMANDOS', 'CERCA COMANDI', 'コマンドを検索', 'ПОИСК КОМАНД', '搜索命令', '搜尋命令'],
    'UNDO': ['RÜCKGÄNGIG', 'DESHACER', 'ANNULLA', '元に戻す', 'ОТМЕНИТЬ', '撤销', '復原'],
    'REDO': ['WIEDERHOLEN', 'REHACER', 'RIPETI', 'やり直し', 'ПОВТОРИТЬ', '重做', '重做'],
    'SNAPPING': ['FANGEN', 'AJUSTE', 'SNAP', 'スナップ', 'ПРИВЯЗКА', '捕捉', '鎖點'],
    'CONSTRUCTION PLANE': ['KONSTRUKTIONSEBENE', 'PLANO DE CONSTRUCCIÓN', 'PIANO DI COSTRUZIONE', '作業平面', 'ПЛОСКОСТЬ ПОСТРОЕНИЯ', '构造平面', '構造平面'],
    'STATE': ['STATUS', 'ESTADO', 'STATO', '状態', 'СОСТОЯНИЕ', '状态', '狀態'],
    'NONE': ['KEINE', 'NINGUNO', 'NESSUNO', 'なし', 'НЕТ', '无', '無'],
    'UPDATING': ['AKTUALISIERT …', 'ACTUALIZANDO', 'AGGIORNAMENTO', '更新中', 'ОБНОВЛЕНИЕ', '更新中', '更新中'],
    'UPDATED': ['AKTUALISIERT', 'ACTUALIZADO', 'AGGIORNATO', '更新済み', 'ОБНОВЛЕНО', '已更新', '已更新'],
    'COMMITTED': ['ÜBERNOMMEN', 'APLICADO', 'APPLICATO', '確定', 'ПРИМЕНЕНО', '已提交', '已提交'],
    'FAILED': ['FEHLGESCHLAGEN', 'FALLIDO', 'NON RIUSCITO', '失敗', 'ОШИБКА', '失败', '失敗'],
    'CANCELLED': ['ABGEBROCHEN', 'CANCELADO', 'ANNULLATO', 'キャンセル済み', 'ОТМЕНЕНО', '已取消', '已取消'],
    'CANCEL': ['ABBRECHEN', 'CANCELAR', 'ANNULLA', 'キャンセル', 'ОТМЕНА', '取消', '取消'],
    'ESC CANCEL': ['ESC ABBRECHEN', 'ESC CANCELAR', 'ESC ANNULLA', 'ESC キャンセル', 'ESC ОТМЕНА', 'ESC 取消', 'ESC 取消'],
    'OK': ['OK', 'ACEPTAR', 'OK', 'OK', 'ОК', '确定', '確定'],
    'VOLUME': ['VOLUMEN', 'VOLUMEN', 'VOLUME', '体積', 'ОБЪЁМ', '体积', '體積'],
    'FACES': ['FLÄCHEN', 'CARAS', 'FACCE', '面', 'ГРАНИ', '面', '面'],
    'EDGES': ['KANTEN', 'ARISTAS', 'SPIGOLI', 'エッジ', 'РЁБРА', '边', '邊'],
    'EDGE': ['KANTE', 'ARISTA', 'SPIGOLO', 'エッジ', 'РЕБРО', '边', '邊'],
    'POINTS': ['PUNKTE', 'PUNTOS', 'PUNTI', '点', 'ТОЧКИ', '点', '點'],
    'POINT': ['PUNKT', 'PUNTO', 'PUNTO', '点', 'ТОЧКА', '点', '點'],
    'ALL': ['ALLE', 'TODO', 'TUTTO', 'すべて', 'ВСЁ', '全部', '全部'],
    'MASS': ['MASSE', 'MASA', 'MASSA', '質量', 'МАССА', '质量', '質量'],
    'TOOLS': ['WERKZEUGE', 'HERRAMIENTAS', 'STRUMENTI', 'ツール', 'ИНСТРУМЕНТЫ', '工具', '工具'],
    'TEXT': ['TEXT', 'TEXTO', 'TESTO', 'テキスト', 'ТЕКСТ', '文字', '文字'],
    'FONT': ['SCHRIFT', 'FUENTE', 'CARATTERE', 'フォント', 'ШРИФТ', '字体', '字型'],
    'SIZE': ['GRÖSSE', 'TAMAÑO', 'DIMENSIONE', 'サイズ', 'РАЗМЕР', '大小', '大小'],
    'ALIGN': ['AUSRICHTEN', 'ALINEAR', 'ALLINEA', '整列', 'ВЫРАВНИВАНИЕ', '对齐', '對齊'],
    'LEFT': ['LINKS', 'IZQUIERDA', 'SINISTRA', '左', 'СЛЕВА', '左', '左'],
    'RIGHT': ['RECHTS', 'DERECHA', 'DESTRA', '右', 'СПРАВА', '右', '右'],
    'CENTER': ['MITTE', 'CENTRO', 'CENTRO', '中央', 'ЦЕНТР', '居中', '置中'],
    'CENTRE': ['MITTE', 'CENTRO', 'CENTRO', '中心', 'ЦЕНТР', '中心', '中心'],
    'DISTANCE': ['ABSTAND', 'DISTANCIA', 'DISTANZA', '距離', 'РАССТОЯНИЕ', '距离', '距離'],
    'DISTANCE 1': ['ABSTAND 1', 'DISTANCIA 1', 'DISTANZA 1', '距離 1', 'РАССТОЯНИЕ 1', '距离 1', '距離 1'],
    'DISTANCE 2': ['ABSTAND 2', 'DISTANCIA 2', 'DISTANZA 2', '距離 2', 'РАССТОЯНИЕ 2', '距离 2', '距離 2'],
    'RADIUS': ['RADIUS', 'RADIO', 'RAGGIO', '半径', 'РАДИУС', '半径', '半徑'],
    'DIAMETER': ['DURCHMESSER', 'DIÁMETRO', 'DIAMETRO', '直径', 'ДИАМЕТР', '直径', '直徑'],
    'ANGLE': ['WINKEL', 'ÁNGULO', 'ANGOLO', '角度', 'УГОЛ', '角度', '角度'],
    'LENGTH': ['LÄNGE', 'LONGITUD', 'LUNGHEZZA', '長さ', 'ДЛИНА', '长度', '長度'],
    'WIDTH': ['BREITE', 'ANCHO', 'LARGHEZZA', '幅', 'ШИРИНА', '宽度', '寬度'],
    'HEIGHT': ['HÖHE', 'ALTO', 'ALTEZZA', '高さ', 'ВЫСОТА', '高度', '高度'],
    'DEPTH': ['TIEFE', 'PROFUNDIDAD', 'PROFONDITÀ', '深さ', 'ГЛУБИНА', '深度', '深度'],
    'THICKNESS': ['DICKE', 'ESPESOR', 'SPESSORE', '厚さ', 'ТОЛЩИНА', '厚度', '厚度'],
    'COUNT': ['ANZAHL', 'CANTIDAD', 'NUMERO', '数', 'КОЛИЧЕСТВО', '数量', '數量'],
    'SPACING': ['ABSTAND', 'ESPACIADO', 'SPAZIATURA', '間隔', 'ИНТЕРВАЛ', '间距', '間距'],
    'TOTAL': ['GESAMT', 'TOTAL', 'TOTALE', '合計', 'ВСЕГО', '总计', '總計'],
    'TOLERANCE': ['TOLERANZ', 'TOLERANCIA', 'TOLLERANZA', '許容差', 'ДОПУСК', '公差', '公差'],
    'TENSION': ['SPANNUNG', 'TENSIÓN', 'TENSIONE', 'テンション', 'НАТЯЖЕНИЕ', '张力', '張力'],
    'G1 TENSION': ['G1-SPANNUNG', 'TENSIÓN G1', 'TENSIONE G1', 'G1 テンション', 'НАТЯЖЕНИЕ G1', 'G1 张力', 'G1 張力'],
    'G2 TENSION': ['G2-SPANNUNG', 'TENSIÓN G2', 'TENSIONE G2', 'G2 テンション', 'НАТЯЖЕНИЕ G2', 'G2 张力', 'G2 張力'],
    'G3 TENSION': ['G3-SPANNUNG', 'TENSIÓN G3', 'TENSIONE G3', 'G3 テンション', 'НАТЯЖЕНИЕ G3', 'G3 张力', 'G3 張力'],
    'CONTINUITY': ['STETIGKEIT', 'CONTINUIDAD', 'CONTINUITÀ', '連続性', 'НЕПРЕРЫВНОСТЬ', '连续性', '連續性'],
    'CURVATURE': ['KRÜMMUNG', 'CURVATURA', 'CURVATURA', '曲率', 'КРИВИЗНА', '曲率', '曲率'],
    'AXIS': ['ACHSE', 'EJE', 'ASSE', '軸', 'ОСЬ', '轴', '軸'],
    'PLANE': ['EBENE', 'PLANO', 'PIANO', '平面', 'ПЛОСКОСТЬ', '平面', '平面'],
    'DIRECTION': ['RICHTUNG', 'DIRECCIÓN', 'DIREZIONE', '方向', 'НАПРАВЛЕНИЕ', '方向', '方向'],
    'PARAMETER': ['PARAMETER', 'PARÁMETRO', 'PARAMETRO', 'パラメータ', 'ПАРАМЕТР', '参数', '參數'],
    'PARAMETER 1': ['PARAMETER 1', 'PARÁMETRO 1', 'PARAMETRO 1', 'パラメータ 1', 'ПАРАМЕТР 1', '参数 1', '參數 1'],
    'PARAMETER 2': ['PARAMETER 2', 'PARÁMETRO 2', 'PARAMETRO 2', 'パラメータ 2', 'ПАРАМЕТР 2', '参数 2', '參數 2'],
    'DEGREE': ['GRAD', 'GRADO', 'GRADO', '次数', 'СТЕПЕНЬ', '阶数', '階數'],
    'SPANS': ['SPANNEN', 'TRAMOS', 'CAMPATE', 'スパン', 'ПРОЛЁТЫ', '跨度', '跨度'],
    'WEIGHT': ['GEWICHT', 'PESO', 'PESO', 'ウェイト', 'ВЕС', '权重', '權重'],
    'SHAPE': ['FORM', 'FORMA', 'FORMA', '形状', 'ФОРМА', '形状', '形狀'],
    'MODE': ['MODUS', 'MODO', 'MODALITÀ', 'モード', 'РЕЖИМ', '模式', '模式'],
    'METHOD': ['METHODE', 'MÉTODO', 'METODO', '方法', 'МЕТОД', '方法', '方法'],
    'OPERATION': ['OPERATION', 'OPERACIÓN', 'OPERAZIONE', '演算', 'ОПЕРАЦИЯ', '运算', '運算'],
    'TARGET': ['ZIEL', 'DESTINO', 'BERSAGLIO', '対象', 'ЦЕЛЬ', '目标', '目標'],
    'TARGETS': ['ZIELE', 'DESTINOS', 'BERSAGLI', '対象', 'ЦЕЛИ', '目标', '目標'],
    'CUTTERS': ['SCHNEIDER', 'CORTADORES', 'TAGLIENTI', 'カッター', 'РЕЗЦЫ', '切割体', '切割體'],
    'RESULT': ['ERGEBNIS', 'RESULTADO', 'RISULTATO', '結果', 'РЕЗУЛЬТАТ', '结果', '結果'],
    'NEW': ['NEU', 'NUEVO', 'NUOVO', '新規', 'НОВЫЙ', '新建', '新增'],
    'UNION': ['VEREINIGEN', 'UNIÓN', 'UNIONE', '和', 'ОБЪЕДИНЕНИЕ', '并集', '聯集'],
    'DIFF': ['DIFFERENZ', 'DIFERENCIA', 'DIFFERENZA', '差', 'РАЗНОСТЬ', '差集', '差集'],
    'INTER': ['SCHNITT', 'INTERSECCIÓN', 'INTERSEZIONE', '積', 'ПЕРЕСЕЧЕНИЕ', '交集', '交集'],
    'SLICE': ['TEILEN', 'DIVIDIR', 'SEZIONA', 'スライス', 'РАЗРЕЗ', '切片', '切片'],
    'KEEP TOOLS': ['WERKZEUGE BEHALTEN', 'CONSERVAR HERRAMIENTAS', 'MANTIENI STRUMENTI', 'ツールを保持', 'СОХРАНИТЬ ИНСТРУМЕНТЫ', '保留工具', '保留工具'],
    'KEEP TOOL': ['WERKZEUG BEHALTEN', 'CONSERVAR HERRAMIENTA', 'MANTIENI STRUMENTO', 'ツールを保持', 'СОХРАНИТЬ ИНСТРУМЕНТ', '保留工具', '保留工具'],
    'INDIVIDUAL': ['EINZELN', 'INDIVIDUAL', 'SINGOLO', '個別', 'ПО ОТДЕЛЬНОСТИ', '单独', '個別'],
    'BOTH SIDES': ['BEIDE SEITEN', 'AMBOS LADOS', 'ENTRAMBI I LATI', '両側', 'ОБЕ СТОРОНЫ', '两侧', '兩側'],
    'BOTH': ['BEIDE', 'AMBOS', 'ENTRAMBI', '両方', 'ОБА', '两者', '兩者'],
    'FLIP': ['UMKEHREN', 'INVERTIR', 'INVERTI', '反転', 'ОТРАЗИТЬ', '翻转', '翻轉'],
    'PIVOT': ['DREHPUNKT', 'PIVOTE', 'PERNO', 'ピボット', 'ОПОРНАЯ ТОЧКА', '枢轴', '樞軸'],
    'SET PIVOT': ['DREHPUNKT SETZEN', 'FIJAR PIVOTE', 'IMPOSTA PERNO', 'ピボットを設定', 'ЗАДАТЬ ОПОРУ', '设置枢轴', '設定樞軸'],
    'REMOVE PIVOT': ['DREHPUNKT ENTFERNEN', 'QUITAR PIVOTE', 'RIMUOVI PERNO', 'ピボットを解除', 'УБРАТЬ ОПОРУ', '移除枢轴', '移除樞軸'],
    'FREESTYLE': ['FREI', 'LIBRE', 'LIBERO', 'フリー', 'СВОБОДНО', '自由', '自由'],
    'INSTANCE': ['INSTANZ', 'INSTANCIA', 'ISTANZA', 'インスタンス', 'ЭКЗЕМПЛЯР', '实例', '實例'],
    'DUPLICATE': ['DUPLIZIEREN', 'DUPLICAR', 'DUPLICA', '複製', 'ДУБЛИРОВАТЬ', '复制', '複製'],
    'REMOVE': ['ENTFERNEN', 'QUITAR', 'RIMUOVI', '削除', 'УДАЛИТЬ', '移除', '移除'],
    'MOVE': ['VERSCHIEBEN', 'MOVER', 'SPOSTA', '移動', 'ПЕРЕМЕСТИТЬ', '移动', '移動'],
    'ROTATE': ['DREHEN', 'ROTAR', 'RUOTA', '回転', 'ПОВЕРНУТЬ', '旋转', '旋轉'],
    'SCALE': ['SKALIEREN', 'ESCALAR', 'SCALA', '拡大縮小', 'МАСШТАБ', '缩放', '縮放'],
    'MIRROR': ['SPIEGELN', 'SIMETRÍA', 'SPECCHIA', 'ミラー', 'ЗЕРКАЛО', '镜像', '鏡像'],
    'EXTRUDE': ['EXTRUDIEREN', 'EXTRUIR', 'ESTRUDI', '押し出し', 'ВЫДАВИТЬ', '拉伸', '擠出'],
    'REVOLVE': ['ROTATIONSKÖRPER', 'REVOLUCIÓN', 'RIVOLUZIONE', '回転体', 'ВРАЩЕНИЕ', '旋转体', '旋轉體'],
    'LOFT': ['LOFT', 'RECUBRIR', 'LOFT', 'ロフト', 'ЛОФТ', '放样', '疊層拉伸'],
    'SWEEP': ['SWEEP', 'BARRIDO', 'SWEEP', 'スイープ', 'СДВИГ', '扫掠', '掃掠'],
    'PIPE': ['ROHR', 'TUBO', 'TUBO', 'パイプ', 'ТРУБА', '圆管', '圓管'],
    'FILLET': ['VERRUNDEN', 'REDONDEO', 'RACCORDO', 'フィレット', 'СКРУГЛЕНИЕ', '圆角', '圓角'],
    'CHAMFER': ['FASE', 'CHAFLÁN', 'SMUSSO', '面取り', 'ФАСКА', '倒角', '倒角'],
    'BOOLEAN': ['BOOLESCH', 'BOOLEANA', 'BOOLEANA', 'ブーリアン', 'БУЛЕВА', '布尔', '布林'],
    'CUT': ['SCHNEIDEN', 'CORTAR', 'TAGLIA', 'カット', 'РАЗРЕЗАТЬ', '切割', '切割'],
    'IMPRINT': ['PRÄGEN', 'IMPRIMIR', 'IMPRONTA', 'インプリント', 'ОТПЕЧАТОК', '压印', '壓印'],
    'HOLLOW': ['AUSHÖHLEN', 'VACIAR', 'SVUOTA', 'シェル', 'ПОЛОСТЬ', '抽壳', '薄殼'],
    'THICKEN': ['AUFDICKEN', 'ENGROSAR', 'ISPESSISCI', '厚み付け', 'УТОЛЩИТЬ', '加厚', '加厚'],
    'PATCH': ['FLICKEN', 'PARCHE', 'TOPPA', 'パッチ', 'ЗАПЛАТКА', '修补', '修補'],
    'PROJECT': ['PROJIZIEREN', 'PROYECTAR', 'PROIETTA', '投影', 'ПРОЕЦИРОВАТЬ', '投影', '投影'],
    'HOLE': ['BOHRUNG', 'AGUJERO', 'FORO', '穴', 'ОТВЕРСТИЕ', '孔', '孔'],
    'TRIM': ['STUTZEN', 'RECORTAR', 'TAGLIA', 'トリム', 'ОБРЕЗАТЬ', '修剪', '修剪'],
    'JOIN': ['VERBINDEN', 'UNIR', 'UNISCI', '結合', 'СОЕДИНИТЬ', '连接', '連接'],
    'OFFSET': ['VERSATZ', 'DESFASE', 'OFFSET', 'オフセット', 'СМЕЩЕНИЕ', '偏移', '偏移'],
    'EXTEND': ['VERLÄNGERN', 'EXTENDER', 'ESTENDI', '延長', 'ПРОДЛИТЬ', '延伸', '延伸'],
    'SUBDIVIDE': ['UNTERTEILEN', 'SUBDIVIDIR', 'SUDDIVIDI', '細分化', 'РАЗДЕЛИТЬ', '细分', '細分'],
    'SPHERE': ['KUGEL', 'ESFERA', 'SFERA', '球', 'СФЕРА', '球体', '球體'],
    'CYLINDER': ['ZYLINDER', 'CILINDRO', 'CILINDRO', '円柱', 'ЦИЛИНДР', '圆柱', '圓柱'],
    'CIRCLE': ['KREIS', 'CÍRCULO', 'CERCHIO', '円', 'ОКРУЖНОСТЬ', '圆', '圓'],
    'ARC': ['BOGEN', 'ARCO', 'ARCO', '円弧', 'ДУГА', '圆弧', '圓弧'],
    'MATERIAL': ['MATERIAL', 'MATERIAL', 'MATERIALE', 'マテリアル', 'МАТЕРИАЛ', '材质', '材質'],
    'LIBRARY': ['BIBLIOTHEK', 'BIBLIOTECA', 'LIBRERIA', 'ライブラリ', 'БИБЛИОТЕКА', '库', '庫'],
    'COLOR': ['FARBE', 'COLOR', 'COLORE', '色', 'ЦВЕТ', '颜色', '顏色'],
    'OPACITY': ['DECKKRAFT', 'OPACIDAD', 'OPACITÀ', '不透明度', 'НЕПРОЗРАЧНОСТЬ', '不透明度', '不透明度'],
    'ROUGHNESS': ['RAUHEIT', 'RUGOSIDAD', 'RUVIDITÀ', '粗さ', 'ШЕРОХОВАТОСТЬ', '粗糙度', '粗糙度'],
    'METALNESS': ['METALLIZITÄT', 'METALICIDAD', 'METALLICITÀ', '金属度', 'МЕТАЛЛИЧНОСТЬ', '金属度', '金屬度'],
    'DENSITY': ['DICHTE', 'DENSIDAD', 'DENSITÀ', '密度', 'ПЛОТНОСТЬ', '密度', '密度'],
    'ENVIRONMENT': ['UMGEBUNG', 'ENTORNO', 'AMBIENTE', '環境', 'ОКРУЖЕНИЕ', '环境', '環境'],
    'ADVANCED': ['ERWEITERT', 'AVANZADO', 'AVANZATE', '詳細', 'ДОПОЛНИТЕЛЬНО', '高级', '進階'],
    'EXPORT': ['EXPORTIEREN', 'EXPORTAR', 'ESPORTA', '書き出し', 'ЭКСПОРТ', '导出', '匯出'],
    'IMPORT': ['IMPORTIEREN', 'IMPORTAR', 'IMPORTA', '読み込み', 'ИМПОРТ', '导入', '匯入'],
    'EXPORT MESH': ['NETZ EXPORTIEREN', 'EXPORTAR MALLA', 'ESPORTA MESH', 'メッシュを書き出し', 'ЭКСПОРТ СЕТКИ', '导出网格', '匯出網格'],
    'EXPORT DRAWING': ['ZEICHNUNG EXPORTIEREN', 'EXPORTAR DIBUJO', 'ESPORTA DISEGNO', '図面を書き出し', 'ЭКСПОРТ ЧЕРТЕЖА', '导出图纸', '匯出圖紙'],
    'FORMAT': ['FORMAT', 'FORMATO', 'FORMATO', '形式', 'ФОРМАТ', '格式', '格式'],
    'PREFERENCES': ['EINSTELLUNGEN', 'PREFERENCIAS', 'PREFERENZE', '環境設定', 'НАСТРОЙКИ', '偏好设置', '偏好設定'],
    'PERFORMANCE': ['LEISTUNG', 'RENDIMIENTO', 'PRESTAZIONI', 'パフォーマンス', 'ПРОИЗВОДИТЕЛЬНОСТЬ', '性能', '效能'],
    'RECENT FILES': ['ZULETZT GEÖFFNET', 'ARCHIVOS RECIENTES', 'FILE RECENTI', '最近使ったファイル', 'НЕДАВНИЕ ФАЙЛЫ', '最近的文件', '最近的檔案'],
    'RESET': ['ZURÜCKSETZEN', 'RESTABLECER', 'REIMPOSTA', 'リセット', 'СБРОС', '重置', '重設'],
    'CLEAR': ['LEEREN', 'BORRAR', 'CANCELLA', 'クリア', 'ОЧИСТИТЬ', '清除', '清除'],
    'GRID': ['RASTER', 'CUADRÍCULA', 'GRIGLIA', 'グリッド', 'СЕТКА', '网格', '格線'],
    'HIDDEN': ['AUSGEBLENDET', 'OCULTO', 'NASCOSTO', '非表示', 'СКРЫТО', '隐藏', '隱藏'],
    'IMAGE': ['BILD', 'IMAGEN', 'IMMAGINE', '画像', 'ИЗОБРАЖЕНИЕ', '图像', '影像'],
    'REGION': ['BEREICH', 'REGIÓN', 'REGIONE', '領域', 'ОБЛАСТЬ', '区域', '區域'],
    'SHEET': ['FLÄCHE', 'LÁMINA', 'SUPERFICIE', 'シート', 'ЛИСТ', '片体', '片體'],
    'BODIES': ['KÖRPER', 'CUERPOS', 'CORPI', 'ボディ', 'ТЕЛА', '实体', '實體'],
    'NO CURVES': ['KEINE KURVEN', 'SIN CURVAS', 'NESSUNA CURVA', 'カーブなし', 'НЕТ КРИВЫХ', '无曲线', '無曲線'],
    'NO SOLIDS': ['KEINE KÖRPER', 'SIN SÓLIDOS', 'NESSUN SOLIDO', 'ソリッドなし', 'НЕТ ТЕЛ', '无实体', '無實體'],
    'NOTHING YET': ['NOCH NICHTS', 'NADA AÚN', 'ANCORA NIENTE', 'まだありません', 'ПОКА НИЧЕГО', '暂无', '尚無'],
    'NOTHING MATCHES': ['KEINE TREFFER', 'SIN COINCIDENCIAS', 'NESSUN RISULTATO', '一致なし', 'НЕТ СОВПАДЕНИЙ', '无匹配', '無符合'],
    'NORMAL': ['NORMAL', 'NORMAL', 'NORMALE', '標準', 'ОБЫЧНЫЙ', '常规', '一般'],
    'ROUND': ['RUND', 'REDONDO', 'ARROTONDATO', '丸', 'СКРУГЛЁННЫЙ', '圆形', '圓形'],
    'LINEAR': ['LINEAR', 'LINEAL', 'LINEARE', '線形', 'ЛИНЕЙНЫЙ', '线性', '線性'],
    'NATURAL': ['NATÜRLICH', 'NATURAL', 'NATURALE', '自然', 'ЕСТЕСТВЕННЫЙ', '自然', '自然'],
    'SOFT': ['WEICH', 'SUAVE', 'MORBIDO', 'ソフト', 'МЯГКИЙ', '柔和', '柔和'],
    'FREE': ['FREI', 'LIBRE', 'LIBERO', 'フリー', 'СВОБОДНЫЙ', '自由', '自由'],
    'FIXED': ['FEST', 'FIJO', 'FISSO', '固定', 'ФИКСИРОВАННЫЙ', '固定', '固定'],
    'MOVING': ['BEWEGLICH', 'MÓVIL', 'MOBILE', '移動', 'ПОДВИЖНЫЙ', '移动', '移動'],
    'INSIDE': ['INNEN', 'DENTRO', 'DENTRO', '内側', 'ВНУТРИ', '内部', '內部'],
    'OUTSIDE': ['AUSSEN', 'FUERA', 'FUORI', '外側', 'СНАРУЖИ', '外部', '外部'],
    'FRONT': ['VORNE', 'FRENTE', 'FRONTE', '前', 'СПЕРЕДИ', '前', '前'],
    'BACK': ['HINTEN', 'ATRÁS', 'RETRO', '後', 'СЗАДИ', '后', '後'],
    'LIMIT POINTS': ['GRENZPUNKTE', 'PUNTOS LÍMITE', 'PUNTI LIMITE', '制限点', 'ПРЕДЕЛЬНЫЕ ТОЧКИ', '限制点', '限制點'],
    'VARIABLE POINTS': ['VARIABLE PUNKTE', 'PUNTOS VARIABLES', 'PUNTI VARIABILI', '可変点', 'ПЕРЕМЕННЫЕ ТОЧКИ', '可变点', '可變點'],
    'CONTROL POINTS': ['KONTROLLPUNKTE', 'PUNTOS DE CONTROL', 'PUNTI DI CONTROLLO', '制御点', 'КОНТРОЛЬНЫЕ ТОЧКИ', '控制点', '控制點'],
    'GUIDES': ['FÜHRUNGEN', 'GUÍAS', 'GUIDE', 'ガイド', 'НАПРАВЛЯЮЩИЕ', '导轨', '導軌'],
    'CONSTRAIN': ['BESCHRÄNKEN', 'RESTRINGIR', 'VINCOLA', '拘束', 'ОГРАНИЧИТЬ', '约束', '約束'],
    'ANALYSIS': ['ANALYSE', 'ANÁLISIS', 'ANALISI', '解析', 'АНАЛИЗ', '分析', '分析'],
    'BOUNDARY': ['RAND', 'CONTORNO', 'CONTORNO', '境界', 'ГРАНИЦА', '边界', '邊界'],
    'SYMMETRIC': ['SYMMETRISCH', 'SIMÉTRICO', 'SIMMETRICO', '対称', 'СИММЕТРИЧНО', '对称', '對稱'],
    'LOAD FONT': ['SCHRIFT LADEN', 'CARGAR FUENTE', 'CARICA CARATTERE', 'フォントを読み込む', 'ЗАГРУЗИТЬ ШРИФТ', '加载字体', '載入字型'],
    'SYSTEM FONT': ['SYSTEMSCHRIFT', 'FUENTE DEL SISTEMA', 'CARATTERE DI SISTEMA', 'システムフォント', 'СИСТЕМНЫЙ ШРИФТ', '系统字体', '系統字型'],
    'TYPE THE TEXT': ['TEXT EINGEBEN', 'ESCRIBE EL TEXTO', 'SCRIVI IL TESTO', 'テキストを入力', 'ВВЕДИТЕ ТЕКСТ', '输入文字', '輸入文字'],
    'RECOVER': ['WIEDERHERSTELLEN', 'RECUPERAR', 'RECUPERA', '復元', 'ВОССТАНОВИТЬ', '恢复', '復原'],
    'DISCARD': ['VERWERFEN', 'DESCARTAR', 'SCARTA', '破棄', 'ОТБРОСИТЬ', '丢弃', '捨棄'],
    'LATER': ['SPÄTER', 'MÁS TARDE', 'PIÙ TARDI', '後で', 'ПОЗЖЕ', '稍后', '稍後'],
    'ORBIT': ['ORBIT', 'ORBITAR', 'ORBITA', 'オービット', 'ВРАЩЕНИЕ', '环绕', '環繞'],
    'PAN': ['VERSCHIEBEN', 'DESPLAZAR', 'PANORAMICA', 'パン', 'ПАНОРАМА', '平移', '平移'],
    'ADD': ['HINZUFÜGEN', 'AÑADIR', 'AGGIUNGI', '追加', 'ДОБАВИТЬ', '添加', '新增'],
    'BOX': ['RAHMEN', 'CAJA', 'RIQUADRO', '矩形', 'РАМКА', '框选', '框選'],
    'SEARCH': ['SUCHEN', 'BUSCAR', 'CERCA', '検索', 'ПОИСК', '搜索', '搜尋'],
    'CLICK': ['KLICK', 'CLIC', 'CLIC', 'クリック', 'ЩЕЛЧОК', '单击', '按一下'],
    'DRAG': ['ZIEHEN', 'ARRASTRAR', 'TRASCINA', 'ドラッグ', 'ПЕРЕТАЩИТЬ', '拖动', '拖曳'],
    'PICK FROM LIST': ['AUS LISTE WÄHLEN', 'ELEGIR DE LA LISTA', 'SCEGLI DALLA LISTA', 'リストから選択', 'ВЫБРАТЬ ИЗ СПИСКА', '从列表选择', '從清單選擇'],
};

/** Each term in one language: English text to that language's, built once per language. */
const tables = new Map();
export function table(lang) {
    const i = LANGUAGES.indexOf(lang) - 1;
    if (i < 0) return null;
    if (!tables.has(lang)) tables.set(lang, new Map(Object.entries(T).map(([en, t]) => [en, t[i]])));
    return tables.get(lang);
}

/**
 * `text` in language `lang`: the whole text if it is a term, else each part between " · " that is
 * one (keeping the spaces around it); null when nothing in it is known, so the text stays as is.
 */
export function translate(text, lang) {
    const t = table(lang);
    if (!t || typeof text !== 'string') return null;
    const key = text.trim();
    if (!key) return null;
    if (t.has(key)) return text.replace(key, t.get(key));
    // A mark before a term (the outliner's ▾ and ▸) stays in front of it.
    const marked = key.match(/^([^\p{L}\p{N}]+)(\p{L}.*)$/u);
    if (marked && t.has(marked[2])) return text.replace(key, marked[1] + t.get(marked[2]));
    if (!key.includes(' · ')) return null;
    let hit = false;
    const parts = key.split(' · ').map(p => { const v = t.get(p.trim()); if (v) hit = true; return v ?? p; });
    return hit ? text.replace(key, parts.join(' · ')) : null;
}

/** How many terms the table has (the same for every language). */
export const TERM_COUNT = Object.keys(T).length;

// --- the page --------------------------------------------------------------------------------

const ATTRS = ['title', 'aria-label', 'placeholder'];
const original = new WeakMap();   // node -> its English text (text nodes) or { attr: English } (elements)
let current = 'en', observer = null;

function translateNode(node) {
    if (node.nodeType === 3) {
        if (!original.has(node)) original.set(node, node.data);
        const en = original.get(node), to = current === 'en' ? en : translate(en, current) ?? en;
        if (node.data !== to) node.data = to;
        return;
    }
    if (node.nodeType !== 1 || node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'TEXTAREA') return;
    let saved = original.get(node);
    for (const a of ATTRS) {
        if (!node.hasAttribute(a)) continue;
        if (!saved) original.set(node, saved = {});
        if (!(a in saved)) saved[a] = node.getAttribute(a);
        const en = saved[a], to = current === 'en' ? en : translate(en, current) ?? en;
        if (node.getAttribute(a) !== to) node.setAttribute(a, to);
    }
    for (const child of node.childNodes) translateNode(child);
}

/**
 * Show the page in `lang` (one of LANGUAGES), now and as it changes: text the app writes later is
 * taken as the new English, so panels, toasts and the HUD follow the language too.
 */
export function setLanguage(root, lang) {
    current = LANGUAGES.includes(lang) ? lang : 'en';
    document.documentElement.lang = current;
    translateNode(root);
    // What this function just wrote is not new English text.
    observer?.takeRecords();
    if (!observer) {
        observer = new MutationObserver(list => {
            for (const m of list) {
                if (m.type === 'characterData') { original.set(m.target, m.target.data); translateNode(m.target); }
                else if (m.type === 'attributes') {
                    const saved = original.get(m.target);
                    if (saved) delete saved[m.attributeName];
                    translateNode(m.target);
                }
                else for (const n of m.addedNodes) { if (n.nodeType === 3) original.set(n, n.data); translateNode(n); }
            }
            // Drop the records of the translations written just now.
            observer.takeRecords();
        });
        observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
}
