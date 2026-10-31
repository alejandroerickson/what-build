-- A page's words are kept beside its HTML, so search never reads the HTML.
--
-- Plain search used to strip every current mockup page and Story page of its markup, on every
-- search. Now each row holds the words a reader sees (`search_text`) and their search vector
-- (`tsv`). Both are generated columns: Postgres computes them in the statement that writes the
-- HTML, so they commit with it, there is no step that can run late or fail on its own, and a row
-- cannot hold words from HTML it no longer has. The ALTER computes them for every row there is.
--
-- The words are what is left of the HTML once comments, script and style blocks and tags with their
-- attributes (so inline SVG paths and data: URIs) are gone, with each entity read as below. An SVG's
-- <text> stays. Script and style are two passes, not one: an alternation, or a backreference, takes
-- the whole expression out of shortest-match, and the match then runs from the first block to the
-- last, taking the words between with it. A backreference is also slow.
--
-- A word spelled with an entity inside it keeps its letter. A reference that stands for a letter
-- becomes that letter, named (&eacute;) or numeric (&#233;, &#xE9;). Every other one is a word break:
-- &lt;, &gt;, &amp; and &quot; in any spelling, &nbsp;, &rsquo;, &shy;, a digit, an emoji, a control
-- character, a name the HTML standard does not have. A reference without its semicolon is not one.
--
-- This adds no markup to the words. Only letters and marks are ever produced, never <, > or &, and
-- each reference is read once, so &amp;lt; is the words "lt;" and not a <. A < that opens no tag
-- stays in the words, so one directly before a letter's reference is given a space: <&#115;cript>
-- is "< script>". Whatever the words hold, every reader of them reads text.
--
-- No text makes either column raise, since an error would make a page impossible to write, and would
-- stop this migration on a page already stored.
--
-- html_search_text has nothing to raise. A number is read only when its length says it fits (leading
-- zeros aside), and chr() is called only for a code point in the table of letters, which holds no 0,
-- no surrogate and nothing past U+10FFFF. An old local cluster in SQL_ASCII has no chr() for most of
-- them, so there a number stays a word break.
--
-- words_search_vector makes a search vector of any text, the words here and what a search still reads
-- when it runs. It catches what to_tsvector raises on text, rather than trusting a bound on the text:
-- a vector holds at most 1 MB of lexemes, and what a character costs depends on how the parser reads
-- it. When a vector does not fit, or a libc cannot read a character, the first three quarters of the
-- text are tried instead. That ends: each try is shorter than the last, so at most 41 of them reach no
-- text at all, and together they cost at most four times the first. Words past the cut stay in
-- search_text, and are not found. Text people write never comes near it, and pays only for entering
-- the block, about a microsecond. A cancelled statement is not caught, so a time limit still ends one.
-- An EXCEPTION block starts a subtransaction, which a parallel worker cannot, so the function is not
-- PARALLEL SAFE. Nothing needs it in parallel: a save, the rewrite below and a search's small reads
-- do not run so.
--
-- The vector reads the words as words, so that the parser's time stays in proportion to the text.
-- Nothing here is markup any more, so a < is a space to it, and it takes nothing for a tag or a comment.
-- A run of more than 255 characters with no space is cut. The cut falls after the last character within
-- reach that is part of no word, so a word stays whole in a list with no spaces or a language written
-- without them, and only a word longer than the reach is cut through. What ends a word is written out
-- in the function, everything outside Unicode's general categories L, M and N, and what ends a run is
-- ASCII's spaces, since a regular expression's character classes follow the database's locale. A page
-- with no such run pays for one look at it, and a short text for less. 255 is the most a regular
-- expression can count.
--
-- References are found by cutting the text at each semicolon and looking at what follows the last &
-- before it, since splitting a page takes milliseconds, where regexp_matches takes about ten
-- microseconds a match. The selects nested in the CASE keep a piece without a reference, and one with
-- a name, from paying for the steps a number takes; OFFSET 0 keeps the planner from copying a step
-- into every place it is used.
--
-- The tables below are fixed, and a database's encoding never changes, so the function is as
-- immutable as its declaration says. letters holds every named reference of the HTML standard whose
-- characters are all letters or marks (Unicode general categories L and M), and the nine numbers from
-- 128 to 159 that browsers read in windows-1252 as letters. ranges holds the code points of those
-- categories in Unicode 17, joined across any code point not assigned yet within a plane, leaving out
-- noncharacters. The table in words_search_vector is made the same way, of everything outside L, M
-- and N.
--
-- Each function stands alone: a backup restores with an empty search_path, and the generated columns
-- call them then, so neither may call a function of ours by an unqualified name. That is why the
-- vector's function takes the words, and the column passes them from html_search_text.
--
-- The ALTERs rewrite both tables, every version of every page, and nothing can read or write them
-- until the migration ends. The locks come first, both of them, before anything is done. The app
-- reads these tables in both orders within a transaction: a Story page's document and an export read
-- story_versions then mockup_pages, and opening a mockup and a search the other way round. No order
-- of locks suits both, and a migration holding one lock while it waits for the other can deadlock
-- with whichever disagrees. So it never waits long holding one: each try gives each lock 200 ms, well
-- inside deadlock_timeout, lets go of what it holds and tries again, so a read it stands in the way
-- of waits a fraction of a second and goes on. Each try takes them in the other order from the last,
-- so traffic running mostly one way meets the order that suits it within a try or two. Two minutes of
-- that, with something holding a table each time, end the migration with an error before it has changed
-- anything. A long transaction can do that, and so can steady traffic both ways, which may leave no
-- moment for either order, so it is run again once that has gone.

DO $$
DECLARE
  began timestamptz := clock_timestamp();
  was text := current_setting('lock_timeout');
  tries int := 0;
BEGIN
  PERFORM set_config('lock_timeout', '200ms', true);
  LOOP
    BEGIN
      IF tries % 2 = 0 THEN
        LOCK TABLE mockup_pages, story_versions IN ACCESS EXCLUSIVE MODE;
      ELSE
        LOCK TABLE story_versions, mockup_pages IN ACCESS EXCLUSIVE MODE;
      END IF;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF clock_timestamp() - began > interval '2 minutes' THEN
        RAISE EXCEPTION 'story_versions and mockup_pages stayed in use for two minutes, and nothing has been changed'
          USING ERRCODE = 'lock_not_available',
                HINT = 'pg_stat_activity and pg_locks show what holds them: a long transaction, a backup, or steady traffic. End it, or run the migration again at a quieter time, or hold traffic off for the moment it needs.';
      END IF;
      tries := tries + 1;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;
  PERFORM set_config('lock_timeout', was, true);
END $$;

CREATE FUNCTION html_search_text(html text) RETURNS text
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
              ELSE (
                SELECT ahead.words || CASE
                    WHEN said.letter IS NULL THEN ' '
                    WHEN right(ahead.words, 1) = '<' OR right(ahead.words, 2) = '</' THEN ' ' || said.letter
                    ELSE said.letter
                  END
                FROM (SELECT left(piece.upto, -length(ref.name) - 1) AS words OFFSET 0) ahead,
                  (
                    SELECT CASE
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
                      END AS letter
                    OFFSET 0
                  ) said
              )
            END
          FROM (SELECT split_part(piece.upto, '&', -1) AS name OFFSET 0) ref
        )
      END, '' ORDER BY piece.n) AS words
    -- Each piece gives its semicolon back unless it ended in a reference. The space closes the last
    -- piece, which nothing follows, so it cannot end in one, and left(…, -1) takes back its semicolon.
    FROM unnest(string_to_array(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(html, '<!--.*?-->', ' ', 'g'),
            '<script\M[^>]*?>.*?</script\M[^>]*>', ' ', 'gi'),
          '<style\M[^>]*?>.*?</style\M[^>]*>', ' ', 'gi'),
        '</?[a-zA-Z!?][^>]*>', ' ', 'g') || ' ', ';')) WITH ORDINALITY AS piece(upto, n)
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

CREATE FUNCTION words_search_vector(words text) RETURNS tsvector
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  kept text := replace(words, '<', ' ');
  pieces text[] := '{}';
  rest text;
  piece text;
BEGIN
  IF octet_length(kept) > 255 AND kept ~ '[^ \t\n\r\f\v]{255}[^ \t\n\r\f\v]' THEN
    rest := kept;
    LOOP
      piece := left(rest, 256);
      EXIT WHEN length(piece) < 256;
      piece := coalesce(
        substring(piece FROM '^.*[ \t\n\r\f\v]'),
        substring(left(piece, 255) FROM
          '^.*[\u0001-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u00A9\u00AB-\u00B1\u00B4\u00B6-\u00B8\u00BB'
          '\u00BF\u00D7\u00F7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u037E'
          '\u0384-\u0385\u0387\u03F6\u0482\u055A-\u055F\u0589-\u058F\u05BE\u05C0\u05C3\u05C6'
          '\u05F3-\u060F\u061B-\u061F\u066A-\u066D\u06D4\u06DD-\u06DE\u06E9\u06FD-\u06FE\u0700-\u070F'
          '\u07F6-\u07F9\u07FE-\u07FF\u0830-\u083E\u085E\u0888\u0890-\u0891\u08E2\u0964-\u0965\u0970'
          '\u09F2-\u09F3\u09FA-\u09FB\u09FD\u0A76\u0AF0-\u0AF1\u0B70\u0BF3-\u0BFA\u0C77\u0C7F\u0C84'
          '\u0D4F\u0D79\u0DF4\u0E3F\u0E4F\u0E5A-\u0E5B\u0F01-\u0F17\u0F1A-\u0F1F\u0F34\u0F36\u0F38'
          '\u0F3A-\u0F3D\u0F85\u0FBE-\u0FC5\u0FC7-\u0FDA\u104A-\u104F\u109E-\u109F\u10FB\u1360-\u1368'
          '\u1390-\u1399\u1400\u166D-\u166E\u1680\u169B-\u169C\u16EB-\u16ED\u1735-\u1736\u17D4-\u17D6'
          '\u17D8-\u17DB\u1800-\u180A\u180E\u1940-\u1945\u19DE-\u19FF\u1A1E-\u1A1F\u1AA0-\u1AA6'
          '\u1AA8-\u1AAD\u1B4E-\u1B4F\u1B5A-\u1B6A\u1B74-\u1B7F\u1BFC-\u1BFF\u1C3B-\u1C3F'
          '\u1C7E-\u1C7F\u1CC0-\u1CC7\u1CD3\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF\u1FDD-\u1FDF\u1FED-\u1FEF'
          '\u1FFD-\u206F\u207A-\u207E\u208A-\u208E\u20A0-\u20C1\u2100-\u2101\u2103-\u2106'
          '\u2108-\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A-\u213B'
          '\u2140-\u2144\u214A-\u214D\u214F\u218A-\u244A\u249C-\u24E9\u2500-\u2775\u2794-\u2BFF'
          '\u2CE5-\u2CEA\u2CF9-\u2CFC\u2CFE-\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u3004\u3008-\u3020\u3030'
          '\u3036-\u3037\u303D-\u303F\u309B-\u309C\u30A0\u30FB\u3190-\u3191\u3196-\u319F\u31C0-\u31EF'
          '\u3200-\u321E\u322A-\u3247\u3250\u3260-\u327F\u328A-\u32B0\u32C0-\u33FF\u4DC0-\u4DFF'
          '\uA490-\uA4C6\uA4FE-\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA716\uA720-\uA721\uA789-\uA78A'
          '\uA828-\uA82B\uA836-\uA839\uA874-\uA877\uA8CE-\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E-\uA92F\uA95F'
          '\uA9C1-\uA9CD\uA9DE-\uA9DF\uAA5C-\uAA5F\uAA77-\uAA79\uAADE-\uAADF\uAAF0-\uAAF1\uAB5B'
          '\uAB6A-\uAB6B\uABEB\uE000-\uF8FF\uFB29\uFBB2-\uFBD2\uFD3E-\uFD4F\uFD90-\uFD91\uFDC8-\uFDCF'
          '\uFDFC-\uFDFF\uFE10-\uFE19\uFE30-\uFE6B\uFEFF-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40'
          '\uFF5B-\uFF65\uFFE0-\uFFFD\U00010100-\U00010102\U00010137-\U0001013F\U00010179-\U00010189'
          '\U0001018C-\U000101FC\U0001039F\U000103D0\U0001056F\U00010857\U00010877-\U00010878'
          '\U0001091F\U0001093F\U00010A50-\U00010A58\U00010A7F\U00010AC8\U00010AF0-\U00010AF6'
          '\U00010B39-\U00010B3F\U00010B99-\U00010B9C\U00010D6E\U00010D8E-\U00010D8F\U00010EAD'
          '\U00010ED0-\U00010ED8\U00010F55-\U00010F59\U00010F86-\U00010F89\U00011047-\U0001104D'
          '\U000110BB-\U000110C1\U000110CD\U00011140-\U00011143\U00011174-\U00011175'
          '\U000111C5-\U000111C8\U000111CD\U000111DB\U000111DD-\U000111DF\U00011238-\U0001123D'
          '\U000112A9\U000113D4-\U000113D8\U0001144B-\U0001144F\U0001145A-\U0001145D\U000114C6'
          '\U000115C1-\U000115D7\U00011641-\U00011643\U00011660-\U0001166C\U000116B9'
          '\U0001173C-\U0001173F\U0001183B\U00011944-\U00011946\U000119E2\U00011A3F-\U00011A46'
          '\U00011A9A-\U00011A9C\U00011A9E-\U00011AA2\U00011B00-\U00011B09\U00011BE1'
          '\U00011C41-\U00011C45\U00011C70-\U00011C71\U00011EF7-\U00011EF8\U00011F43-\U00011F4F'
          '\U00011FD5-\U00011FFF\U00012470-\U00012474\U00012FF1-\U00012FF2\U00013430-\U0001343F'
          '\U00016A6E-\U00016A6F\U00016AF5\U00016B37-\U00016B3F\U00016B44-\U00016B45'
          '\U00016D6D-\U00016D6F\U00016E97-\U00016E9A\U00016FE2\U0001BC9C\U0001BC9F-\U0001CCEF'
          '\U0001CCFA-\U0001CEF0\U0001CF50-\U0001D164\U0001D16A-\U0001D16C\U0001D173-\U0001D17A'
          '\U0001D183-\U0001D184\U0001D18C-\U0001D1A9\U0001D1AE-\U0001D241\U0001D245'
          '\U0001D300-\U0001D356\U0001D6C1\U0001D6DB\U0001D6FB\U0001D715\U0001D735\U0001D74F'
          '\U0001D76F\U0001D789\U0001D7A9\U0001D7C3\U0001D800-\U0001D9FF\U0001DA37-\U0001DA3A'
          '\U0001DA6D-\U0001DA74\U0001DA76-\U0001DA83\U0001DA85-\U0001DA8B\U0001E14F\U0001E2FF'
          '\U0001E5FF\U0001E95E-\U0001E95F\U0001ECAC\U0001ECB0\U0001ED2E\U0001EEF0-\U0001F0F5'
          '\U0001F10D-\U0001FBEF\U0001FBFA\U000E0001-\U000E007F\U000F0000-\U0010FFFD]'),
        left(piece, 255));
      pieces := pieces || piece;
      rest := right(rest, -length(piece));
    END LOOP;
    kept := array_to_string(pieces, ' ') || ' ' || rest;
  END IF;
  LOOP
    BEGIN
      RETURN to_tsvector('simple', kept);
    EXCEPTION WHEN program_limit_exceeded OR character_not_in_repertoire THEN
      EXIT WHEN kept = '';
      kept := left(kept, length(kept) * 3 / 4);
    END;
  END LOOP;
  RETURN ''::tsvector;
END
$$;

ALTER TABLE mockup_pages
  ADD COLUMN search_text text GENERATED ALWAYS AS (html_search_text(html)) STORED,
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (words_search_vector(html_search_text(html))) STORED;

ALTER TABLE story_versions
  ADD COLUMN search_text text GENERATED ALWAYS AS (html_search_text(html)) STORED,
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (words_search_vector(html_search_text(html))) STORED;
