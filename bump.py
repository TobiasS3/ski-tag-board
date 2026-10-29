# Vor jedem Hochladen ausführen: neue Versionsnummer für app.js/style.css, damit Browser die neue Version laden.
import re, time, pathlib
v = str(int(time.time()))
root = pathlib.Path(__file__).parent
for f in root.glob("*.html"):
    t = f.read_text()
    t = re.sub(r'style\.css(\?v=\d+)?"', f'style.css?v={v}"', t)
    t = re.sub(r'app\.js(\?v=\d+)?"', f'app.js?v={v}"', t)
    f.write_text(t)
app = root / "app.js"
app.write_text(re.sub(r'const APP_VERSION = "\d+";', f'const APP_VERSION = "{v}";', app.read_text()))
(root / "version.json").write_text('{"v": "%s"}\n' % v)
print("Version", v)
