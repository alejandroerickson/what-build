-- A word spelled with an entity inside it keeps its letter.
--
-- html_search_text put a space in place of every entity, so caf&eacute; was kept as "caf" and a
-- search for café found nothing. A reference that stands for a letter now becomes that letter, named
-- (&eacute;) or numeric (&#233;, &#xE9;). Every other one stays a word break, as it was: &lt;, &gt;,
-- &amp; and &quot; in any spelling, &nbsp;, &rsquo;, &shy;, a digit, an emoji, a control character, a
-- name the HTML standard does not have. A reference without its semicolon is not one, as it was not.
--
-- This adds no markup to the words. Only letters and marks are ever produced, never <, > or &, and
-- each reference is read once, so &amp;lt; is the words "lt;" and not a <. A < that opens no tag
-- stays in the words, so one directly before an & is given a space: <&#115;cript> would otherwise
-- become a whole tag after the pass that removes tags has gone by, and a search vector would drop
-- the word with it. Whatever the words hold, every reader of them reads text.
--
-- Nothing here can raise an error, since an error would make the page impossible to write. A number
-- is read only when its length says it fits (leading zeros aside), and chr() is called only for a
-- code point in the table of letters, which holds no 0, no surrogate and nothing past U+10FFFF. An
-- old local cluster in SQL_ASCII has no chr() for most of them, so there a number stays a word break.
--
-- References are found by cutting the text at each semicolon and looking at what follows the last &
-- before it. Splitting a page takes milliseconds, where regexp_matches takes about ten microseconds
-- a match, which on a page of nothing but references would be seconds on every save. The selects
-- nested in the CASE keep a piece without a reference, and one with a name, from paying for the
-- steps a number takes; OFFSET 0 keeps the planner from copying a step into every place it is used.
--
-- The tables below are fixed, and a database's encoding never changes, so the function is as
-- immutable as its declaration says. letters holds every named reference of the HTML standard whose
-- characters are all letters or marks (Unicode general categories L and M), and the nine numbers from
-- 128 to 159 that browsers read in windows-1252 as letters. ranges holds the code points of those
-- categories in Unicode 17, joined across any code point not assigned yet within a plane, leaving out
-- noncharacters.
--
-- Everything is in this one function: a backup restores with an empty search_path, and the generated
-- columns call it then, so it must not call a function of ours by an unqualified name.
--
-- Replacing the function changes no row, so both tables have their columns rebuilt, which is a full
-- rewrite. Nothing depends on these columns (no index, view or policy), and they are not in any
-- answer or export. The locks come first, together, so that no search holding one of the tables can
-- deadlock with a rewrite already under way on the other. No save can keep the old words: one that
-- finished before the lock is rewritten, and one waiting for the lock uses the new function.

LOCK TABLE mockup_pages, story_versions IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION html_search_text(html text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT left(btrim(
    regexp_replace(
      regexp_replace(left(spelled.words, -1), '\s+', ' ', 'g'),
      ' ([,.;:!?)])', '\1', 'g')),
    200000)
  FROM (
    SELECT string_agg(CASE
        WHEN position('&' IN piece.upto) = 0 THEN piece.upto || ';'
        ELSE (
          SELECT CASE
              WHEN ref.name !~ '^[a-zA-Z0-9#]+$' THEN piece.upto || ';'
              ELSE left(piece.upto, -length(ref.name) - 1) || coalesce(CASE
                  WHEN left(ref.name, 1) <> '#' THEN known.letters ->> ref.name
                  ELSE (
                    SELECT CASE
                        WHEN code.n BETWEEN 128 AND 159 THEN known.letters ->> ('#' || code.n)
                        WHEN code.n <@ known.ranges AND getdatabaseencoding() = 'UTF8' THEN chr(code.n)
                      END
                    FROM (
                      SELECT CASE
                          WHEN left(ref.name, 2) IN ('#x', '#X') THEN
                            CASE WHEN length(num.digits) BETWEEN 1 AND 6 AND ltrim(num.digits, '0123456789abcdefABCDEF') = ''
                              THEN ('x' || lpad(num.digits, 8, '0'))::bit(32)::int END
                          WHEN length(num.digits) BETWEEN 1 AND 7 AND ltrim(num.digits, '0123456789') = ''
                            THEN num.digits::int
                        END AS n
                      FROM (
                        SELECT ltrim(substr(ref.name, CASE WHEN left(ref.name, 2) IN ('#x', '#X') THEN 3 ELSE 2 END), '0') AS digits
                        OFFSET 0
                      ) num
                      OFFSET 0
                    ) code
                  )
                END, ' ')
            END
          FROM (SELECT split_part(piece.upto, '&', -1) AS name OFFSET 0) ref
        )
      END, '' ORDER BY piece.n) AS words
    -- Each piece gives its semicolon back unless it ended in a reference. The space closes the last
    -- piece, which nothing follows, so it cannot end in one, and left(…, -1) takes back its semicolon.
    FROM unnest(string_to_array(
      replace(replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(html, '<!--.*?-->', ' ', 'g'),
              '<script\M[^>]*?>.*?</script\M[^>]*>', ' ', 'gi'),
            '<style\M[^>]*?>.*?</style\M[^>]*>', ' ', 'gi'),
          '</?[a-zA-Z!?][^>]*>', ' ', 'g'),
        '<&', '< &'),
        '</&', '</ &') || ' ', ';')) WITH ORDINALITY AS piece(upto, n)
    CROSS JOIN (SELECT
      '{
      "#131":"ƒ","#136":"ˆ","#138":"Š","#140":"Œ","#142":"Ž","#154":"š","#156":"œ","#158":"ž",
      "#159":"Ÿ","AElig":"Æ","Aacute":"Á","Abreve":"Ă","Acirc":"Â","Acy":"А","Afr":"𝔄",
      "Agrave":"À","Alpha":"Α","Amacr":"Ā","Aogon":"Ą","Aopf":"𝔸","Aring":"Å","Ascr":"𝒜",
      "Atilde":"Ã","Auml":"Ä","Bcy":"Б","Bernoullis":"ℬ","Beta":"Β","Bfr":"𝔅","Bopf":"𝔹",
      "Bscr":"ℬ","CHcy":"Ч","Cacute":"Ć","CapitalDifferentialD":"ⅅ","Cayleys":"ℭ","Ccaron":"Č",
      "Ccedil":"Ç","Ccirc":"Ĉ","Cdot":"Ċ","Cfr":"ℭ","Chi":"Χ","Copf":"ℂ","Cscr":"𝒞","DD":"ⅅ",
      "DJcy":"Ђ","DScy":"Ѕ","DZcy":"Џ","Dcaron":"Ď","Dcy":"Д","Delta":"Δ","Dfr":"𝔇",
      "DifferentialD":"ⅆ","Dopf":"𝔻","DotDot":"⃜","DownBreve":"̑","Dscr":"𝒟","Dstrok":"Đ",
      "ENG":"Ŋ","ETH":"Ð","Eacute":"É","Ecaron":"Ě","Ecirc":"Ê","Ecy":"Э","Edot":"Ė","Efr":"𝔈",
      "Egrave":"È","Emacr":"Ē","Eogon":"Ę","Eopf":"𝔼","Epsilon":"Ε","Escr":"ℰ","Eta":"Η",
      "Euml":"Ë","ExponentialE":"ⅇ","Fcy":"Ф","Ffr":"𝔉","Fopf":"𝔽","Fouriertrf":"ℱ","Fscr":"ℱ",
      "GJcy":"Ѓ","Gamma":"Γ","Gammad":"Ϝ","Gbreve":"Ğ","Gcedil":"Ģ","Gcirc":"Ĝ","Gcy":"Г",
      "Gdot":"Ġ","Gfr":"𝔊","Gopf":"𝔾","Gscr":"𝒢","HARDcy":"Ъ","Hacek":"ˇ","Hcirc":"Ĥ","Hfr":"ℌ",
      "HilbertSpace":"ℋ","Hopf":"ℍ","Hscr":"ℋ","Hstrok":"Ħ","IEcy":"Е","IJlig":"Ĳ","IOcy":"Ё",
      "Iacute":"Í","Icirc":"Î","Icy":"И","Idot":"İ","Ifr":"ℑ","Igrave":"Ì","Im":"ℑ","Imacr":"Ī",
      "ImaginaryI":"ⅈ","Iogon":"Į","Iopf":"𝕀","Iota":"Ι","Iscr":"ℐ","Itilde":"Ĩ","Iukcy":"І",
      "Iuml":"Ï","Jcirc":"Ĵ","Jcy":"Й","Jfr":"𝔍","Jopf":"𝕁","Jscr":"𝒥","Jsercy":"Ј","Jukcy":"Є",
      "KHcy":"Х","KJcy":"Ќ","Kappa":"Κ","Kcedil":"Ķ","Kcy":"К","Kfr":"𝔎","Kopf":"𝕂","Kscr":"𝒦",
      "LJcy":"Љ","Lacute":"Ĺ","Lambda":"Λ","Laplacetrf":"ℒ","Lcaron":"Ľ","Lcedil":"Ļ","Lcy":"Л",
      "Lfr":"𝔏","Lmidot":"Ŀ","Lopf":"𝕃","Lscr":"ℒ","Lstrok":"Ł","Mcy":"М","Mellintrf":"ℳ",
      "Mfr":"𝔐","Mopf":"𝕄","Mscr":"ℳ","Mu":"Μ","NJcy":"Њ","Nacute":"Ń","Ncaron":"Ň","Ncedil":"Ņ",
      "Ncy":"Н","Nfr":"𝔑","Nopf":"ℕ","Nscr":"𝒩","Ntilde":"Ñ","Nu":"Ν","OElig":"Œ","Oacute":"Ó",
      "Ocirc":"Ô","Ocy":"О","Odblac":"Ő","Ofr":"𝔒","Ograve":"Ò","Omacr":"Ō","Omega":"Ω",
      "Omicron":"Ο","Oopf":"𝕆","Oscr":"𝒪","Oslash":"Ø","Otilde":"Õ","Ouml":"Ö","Pcy":"П",
      "Pfr":"𝔓","Phi":"Φ","Pi":"Π","Poincareplane":"ℌ","Popf":"ℙ","Pscr":"𝒫","Psi":"Ψ","Qfr":"𝔔",
      "Qopf":"ℚ","Qscr":"𝒬","Racute":"Ŕ","Rcaron":"Ř","Rcedil":"Ŗ","Rcy":"Р","Re":"ℜ","Rfr":"ℜ",
      "Rho":"Ρ","Ropf":"ℝ","Rscr":"ℛ","SHCHcy":"Щ","SHcy":"Ш","SOFTcy":"Ь","Sacute":"Ś",
      "Scaron":"Š","Scedil":"Ş","Scirc":"Ŝ","Scy":"С","Sfr":"𝔖","Sigma":"Σ","Sopf":"𝕊",
      "Sscr":"𝒮","THORN":"Þ","TSHcy":"Ћ","TScy":"Ц","Tau":"Τ","Tcaron":"Ť","Tcedil":"Ţ","Tcy":"Т",
      "Tfr":"𝔗","Theta":"Θ","Topf":"𝕋","TripleDot":"⃛","Tscr":"𝒯","Tstrok":"Ŧ","Uacute":"Ú",
      "Ubrcy":"Ў","Ubreve":"Ŭ","Ucirc":"Û","Ucy":"У","Udblac":"Ű","Ufr":"𝔘","Ugrave":"Ù",
      "Umacr":"Ū","Uogon":"Ų","Uopf":"𝕌","Upsi":"ϒ","Upsilon":"Υ","Uring":"Ů","Uscr":"𝒰",
      "Utilde":"Ũ","Uuml":"Ü","Vcy":"В","Vfr":"𝔙","Vopf":"𝕍","Vscr":"𝒱","Wcirc":"Ŵ","Wfr":"𝔚",
      "Wopf":"𝕎","Wscr":"𝒲","Xfr":"𝔛","Xi":"Ξ","Xopf":"𝕏","Xscr":"𝒳","YAcy":"Я","YIcy":"Ї",
      "YUcy":"Ю","Yacute":"Ý","Ycirc":"Ŷ","Ycy":"Ы","Yfr":"𝔜","Yopf":"𝕐","Yscr":"𝒴","Yuml":"Ÿ",
      "ZHcy":"Ж","Zacute":"Ź","Zcaron":"Ž","Zcy":"З","Zdot":"Ż","Zeta":"Ζ","Zfr":"ℨ","Zopf":"ℤ",
      "Zscr":"𝒵","aacute":"á","abreve":"ă","acirc":"â","acy":"а","aelig":"æ","afr":"𝔞",
      "agrave":"à","alefsym":"ℵ","aleph":"ℵ","alpha":"α","amacr":"ā","angst":"Å","aogon":"ą",
      "aopf":"𝕒","aring":"å","ascr":"𝒶","atilde":"ã","auml":"ä","bcy":"б","bernou":"ℬ","beta":"β",
      "beth":"ℶ","bfr":"𝔟","bopf":"𝕓","bscr":"𝒷","cacute":"ć","caron":"ˇ","ccaron":"č",
      "ccedil":"ç","ccirc":"ĉ","cdot":"ċ","cfr":"𝔠","chcy":"ч","chi":"χ","circ":"ˆ",
      "complexes":"ℂ","copf":"𝕔","cscr":"𝒸","daleth":"ℸ","dcaron":"ď","dcy":"д","dd":"ⅆ",
      "delta":"δ","dfr":"𝔡","digamma":"ϝ","djcy":"ђ","dopf":"𝕕","dscr":"𝒹","dscy":"ѕ",
      "dstrok":"đ","dzcy":"џ","eacute":"é","ecaron":"ě","ecirc":"ê","ecy":"э","edot":"ė","ee":"ⅇ",
      "efr":"𝔢","egrave":"è","ell":"ℓ","emacr":"ē","eng":"ŋ","eogon":"ę","eopf":"𝕖","epsi":"ε",
      "epsilon":"ε","epsiv":"ϵ","escr":"ℯ","eta":"η","eth":"ð","euml":"ë","expectation":"ℰ",
      "exponentiale":"ⅇ","fcy":"ф","ffilig":"ﬃ","fflig":"ﬀ","ffllig":"ﬄ","ffr":"𝔣","filig":"ﬁ",
      "fjlig":"fj","fllig":"ﬂ","fnof":"ƒ","fopf":"𝕗","fscr":"𝒻","gacute":"ǵ","gamma":"γ",
      "gammad":"ϝ","gbreve":"ğ","gcirc":"ĝ","gcy":"г","gdot":"ġ","gfr":"𝔤","gimel":"ℷ","gjcy":"ѓ",
      "gopf":"𝕘","gscr":"ℊ","hamilt":"ℋ","hardcy":"ъ","hbar":"ℏ","hcirc":"ĥ","hfr":"𝔥",
      "hopf":"𝕙","hscr":"𝒽","hslash":"ℏ","hstrok":"ħ","iacute":"í","icirc":"î","icy":"и",
      "iecy":"е","ifr":"𝔦","igrave":"ì","ii":"ⅈ","ijlig":"ĳ","imacr":"ī","image":"ℑ",
      "imagline":"ℐ","imagpart":"ℑ","imath":"ı","imped":"Ƶ","inodot":"ı","integers":"ℤ","iocy":"ё",
      "iogon":"į","iopf":"𝕚","iota":"ι","iscr":"𝒾","itilde":"ĩ","iukcy":"і","iuml":"ï",
      "jcirc":"ĵ","jcy":"й","jfr":"𝔧","jmath":"ȷ","jopf":"𝕛","jscr":"𝒿","jsercy":"ј","jukcy":"є",
      "kappa":"κ","kappav":"ϰ","kcedil":"ķ","kcy":"к","kfr":"𝔨","kgreen":"ĸ","khcy":"х","kjcy":"ќ",
      "kopf":"𝕜","kscr":"𝓀","lacute":"ĺ","lagran":"ℒ","lambda":"λ","lcaron":"ľ","lcedil":"ļ",
      "lcy":"л","lfr":"𝔩","ljcy":"љ","lmidot":"ŀ","lopf":"𝕝","lscr":"𝓁","lstrok":"ł","mcy":"м",
      "mfr":"𝔪","micro":"µ","mopf":"𝕞","mscr":"𝓂","mu":"μ","nacute":"ń","napos":"ŉ",
      "naturals":"ℕ","ncaron":"ň","ncedil":"ņ","ncy":"н","nfr":"𝔫","njcy":"њ","nopf":"𝕟",
      "nscr":"𝓃","ntilde":"ñ","nu":"ν","oacute":"ó","ocirc":"ô","ocy":"о","odblac":"ő","oelig":"œ",
      "ofr":"𝔬","ograve":"ò","ohm":"Ω","omacr":"ō","omega":"ω","omicron":"ο","oopf":"𝕠",
      "order":"ℴ","orderof":"ℴ","ordf":"ª","ordm":"º","oscr":"ℴ","oslash":"ø","otilde":"õ",
      "ouml":"ö","pcy":"п","pfr":"𝔭","phi":"φ","phiv":"ϕ","phmmat":"ℳ","pi":"π","piv":"ϖ",
      "planck":"ℏ","planckh":"ℎ","plankv":"ℏ","popf":"𝕡","primes":"ℙ","pscr":"𝓅","psi":"ψ",
      "qfr":"𝔮","qopf":"𝕢","qscr":"𝓆","quaternions":"ℍ","racute":"ŕ","rationals":"ℚ",
      "rcaron":"ř","rcedil":"ŗ","rcy":"р","real":"ℜ","realine":"ℛ","realpart":"ℜ","reals":"ℝ",
      "rfr":"𝔯","rho":"ρ","rhov":"ϱ","ropf":"𝕣","rscr":"𝓇","sacute":"ś","scaron":"š",
      "scedil":"ş","scirc":"ŝ","scy":"с","sfr":"𝔰","shchcy":"щ","shcy":"ш","sigma":"σ",
      "sigmaf":"ς","sigmav":"ς","softcy":"ь","sopf":"𝕤","sscr":"𝓈","straightepsilon":"ϵ",
      "straightphi":"ϕ","szlig":"ß","tau":"τ","tcaron":"ť","tcedil":"ţ","tcy":"т","tdot":"⃛",
      "tfr":"𝔱","theta":"θ","thetasym":"ϑ","thetav":"ϑ","thorn":"þ","topf":"𝕥","tscr":"𝓉",
      "tscy":"ц","tshcy":"ћ","tstrok":"ŧ","uacute":"ú","ubrcy":"ў","ubreve":"ŭ","ucirc":"û",
      "ucy":"у","udblac":"ű","ufr":"𝔲","ugrave":"ù","umacr":"ū","uogon":"ų","uopf":"𝕦","upsi":"υ",
      "upsih":"ϒ","upsilon":"υ","uring":"ů","uscr":"𝓊","utilde":"ũ","uuml":"ü","varepsilon":"ϵ",
      "varkappa":"ϰ","varphi":"ϕ","varpi":"ϖ","varrho":"ϱ","varsigma":"ς","vartheta":"ϑ","vcy":"в",
      "vfr":"𝔳","vopf":"𝕧","vscr":"𝓋","wcirc":"ŵ","wfr":"𝔴","wopf":"𝕨","wscr":"𝓌","xfr":"𝔵",
      "xi":"ξ","xopf":"𝕩","xscr":"𝓍","yacute":"ý","yacy":"я","ycirc":"ŷ","ycy":"ы","yfr":"𝔶",
      "yicy":"ї","yopf":"𝕪","yscr":"𝓎","yucy":"ю","yuml":"ÿ","zacute":"ź","zcaron":"ž","zcy":"з",
      "zdot":"ż","zeetrf":"ℨ","zeta":"ζ","zfr":"𝔷","zhcy":"ж","zopf":"𝕫","zscr":"𝓏"
      }'::jsonb AS letters,
      '{
      [65,90],[97,122],[170,170],[181,181],[186,186],[192,214],[216,246],[248,705],[710,721],
      [736,740],[748,748],[750,750],[768,884],[886,893],[895,895],[902,902],[904,1013],[1015,1153],
      [1155,1369],[1376,1416],[1425,1469],[1471,1471],[1473,1474],[1476,1477],[1479,1522],
      [1552,1562],[1568,1631],[1646,1747],[1749,1756],[1759,1768],[1770,1775],[1786,1788],
      [1791,1791],[1808,1969],[1994,2037],[2042,2045],[2048,2093],[2112,2139],[2144,2183],
      [2185,2191],[2199,2273],[2275,2403],[2417,2531],[2544,2545],[2556,2556],[2558,2654],
      [2672,2677],[2689,2787],[2809,2915],[2929,2929],[2946,3031],[3072,3171],[3200,3203],
      [3205,3299],[3313,3406],[3412,3415],[3423,3427],[3450,3551],[3570,3571],[3585,3642],
      [3648,3662],[3713,3790],[3804,3840],[3864,3865],[3893,3893],[3895,3895],[3897,3897],
      [3902,3972],[3974,4028],[4038,4038],[4096,4159],[4176,4239],[4250,4253],[4256,4346],
      [4348,4959],[4992,5007],[5024,5117],[5121,5740],[5743,5759],[5761,5786],[5792,5866],
      [5873,5940],[5952,6099],[6103,6103],[6108,6109],[6155,6157],[6159,6159],[6176,6459],
      [6480,6601],[6656,6683],[6688,6783],[6823,6823],[6832,6988],[7019,7027],[7040,7087],
      [7098,7155],[7168,7223],[7245,7247],[7258,7293],[7296,7359],[7376,7378],[7380,8124],
      [8126,8126],[8130,8140],[8144,8155],[8160,8172],[8178,8188],[8305,8305],[8319,8319],
      [8336,8348],[8400,8432],[8450,8450],[8455,8455],[8458,8467],[8469,8469],[8473,8477],
      [8484,8484],[8486,8486],[8488,8488],[8490,8493],[8495,8505],[8508,8511],[8517,8521],
      [8526,8526],[8579,8580],[11264,11492],[11499,11507],[11520,11631],[11647,11775],[11823,11823],
      [12293,12294],[12330,12335],[12337,12341],[12347,12348],[12353,12442],[12445,12447],
      [12449,12538],[12540,12686],[12704,12735],[12784,12799],[13312,19903],[19968,42124],
      [42192,42237],[42240,42508],[42512,42527],[42538,42610],[42612,42621],[42623,42725],
      [42736,42737],[42775,42783],[42786,42888],[42891,43047],[43052,43052],[43072,43123],
      [43136,43205],[43232,43255],[43259,43259],[43261,43263],[43274,43309],[43312,43347],
      [43360,43456],[43471,43471],[43488,43503],[43514,43597],[43616,43638],[43642,43741],
      [43744,43759],[43762,43866],[43868,43881],[43888,44010],[44012,44013],[44032,55291],
      [63744,64296],[64298,64433],[64467,64829],[64848,64911],[64914,64967],[65008,65019],
      [65024,65039],[65056,65071],[65136,65276],[65313,65338],[65345,65370],[65382,65500],
      [65536,65786],[66045,66272],[66304,66335],[66349,66368],[66370,66377],[66384,66461],
      [66464,66511],[66560,66717],[66736,66915],[66928,67669],[67680,67702],[67712,67742],
      [67808,67829],[67840,67861],[67872,67897],[67904,68023],[68030,68031],[68096,68159],
      [68192,68220],[68224,68252],[68288,68295],[68297,68326],[68352,68405],[68416,68437],
      [68448,68466],[68480,68497],[68608,68850],[68864,68903],[68938,68973],[68975,68997],
      [69248,69292],[69296,69319],[69370,69404],[69415,69456],[69488,69509],[69552,69572],
      [69600,69702],[69744,69818],[69826,69826],[69840,69864],[69888,69940],[69956,70003],
      [70006,70084],[70089,70092],[70094,70095],[70106,70106],[70108,70108],[70144,70199],
      [70206,70312],[70320,70378],[70400,70611],[70625,70730],[70750,70853],[70855,70855],
      [71040,71104],[71128,71232],[71236,71236],[71296,71352],[71424,71467],[71488,71738],
      [71840,71903],[71935,72003],[72096,72161],[72163,72254],[72263,72345],[72349,72349],
      [72368,72440],[72544,72672],[72704,72768],[72818,73031],[73056,73112],[73136,73179],
      [73440,73462],[73472,73538],[73562,73648],[73728,74649],[74880,77808],[77824,78895],
      [78912,90415],[92160,92766],[92784,92862],[92880,92916],[92928,92982],[92992,92995],
      [93027,93548],[93760,93823],[93856,94177],[94179,94195],[94208,113817],[113821,113822],
      [118528,118598],[119141,119145],[119149,119154],[119163,119170],[119173,119179],
      [119210,119213],[119362,119364],[119808,120512],[120514,120538],[120540,120570],
      [120572,120596],[120598,120628],[120630,120654],[120656,120686],[120688,120712],
      [120714,120744],[120746,120770],[120772,120779],[121344,121398],[121403,121452],
      [121461,121461],[121476,121476],[121499,123197],[123214,123214],[123536,123631],
      [124112,124143],[124368,124400],[124608,125124],[125136,125259],[126464,126651],
      [131072,195101],[196608,210041],[917760,917999]
      }'::int4multirange AS ranges
    ) known
  ) spelled
$$;

ALTER TABLE mockup_pages
  DROP COLUMN search_text,
  DROP COLUMN tsv,
  ADD COLUMN search_text text GENERATED ALWAYS AS (html_search_text(html)) STORED,
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', html_search_text(html))) STORED;

ALTER TABLE story_versions
  DROP COLUMN search_text,
  DROP COLUMN tsv,
  ADD COLUMN search_text text GENERATED ALWAYS AS (html_search_text(html)) STORED,
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', html_search_text(html))) STORED;
