# nano-wsgi-profiler
Install it as WSGI middleware: `app = NanoProfilerMiddleware(app)` and visit your site with query:
`localhost/?_profile=on`, then profile result will be inserted to original response (with all CSS and JS embedded,
and they are small enough). Cookie will be set once you enabled profiler.

### Requirements
* Python 2 or 3
* jinja2 (maybe not nano enough?)

### Screenshot
![profiling-flaskr](https://github.com/krrr/krrr.github.io/raw/master/images/nano-wsgi-profiler.png)

### Frontend lib used
* Pure.css
* tablesort.js
