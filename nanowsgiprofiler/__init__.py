# some code taken from flask_debug toolbar
import time
import re
try:
    from cProfile import Profile
except ImportError:
    from profile import Profile
import pstats
from wsgiref.headers import Headers
from jinja2 import Template
from nanowsgiprofiler.helper import *
if PY2:
    from Cookie import Cookie
else:
    from http.cookies import BaseCookie as Cookie


_file_path = os.path.abspath(os.path.dirname(__file__))

with open(os.path.join(_file_path, 'profiler.html'), 'rb') as _f:
    _template = Template(_f.read().decode('utf-8'))

_find_charset = re.compile(r'.+charset=([^ ;]+)')


class NanoProfilerMiddleware(object):
    SIMPLE_OUTPUT_TOGGLE_KEY = '__nanopro_s_o'

    def __init__(self, app, simple_output=True):
        self.toggle_key = '_profiler'
        self.enable_value = 'on'
        self._app = app
        self.simple_output = simple_output

    def _intercept_call(self):
        """Return (run_app, resp_body, saved_ss_args). After calling run_app(environ)
        resp_body will contain response, and saved_ss_args contain args which
        app used to call start_response."""
        resp_body, saved_ss_args = [], []

        def start_response_proxy(*args):
            saved_ss_args.extend(args)
            return resp_body.append

        def run_app(environ):
            app_iter = self._app(environ, start_response_proxy)
            resp_body.extend(app_iter)
            if hasattr(app_iter, 'close'):
                app_iter.close()

        return run_app, resp_body, saved_ss_args

    def __call__(self, environ, start_response):
        key_morsel = Cookie(environ.get('HTTP_COOKIE', '')).get(self.toggle_key)
        # useful vars
        query = query_str2dict(environ.get('QUERY_STRING'))
        enable_by_cookie = key_morsel.value == self.enable_value if key_morsel else False
        enable_by_query = query.get(self.toggle_key) == self.enable_value
        # pop toggle_key from query dic to avoid case: '?_profile=on&_profile='
        disable = query.pop(self.toggle_key, None) == ''  # only can be disabled by query
        enable = not disable and (enable_by_query or enable_by_cookie)

        run_app, resp_body, saved_ss_args = self._intercept_call()

        # processing cookies and queries
        so = query.pop(self.SIMPLE_OUTPUT_TOGGLE_KEY, None)
        if so is not None:
            self.simple_output = so == 'True'
        cookie_to_set = None
        if enable_by_query and not enable_by_cookie:
            cookie_to_set = '%s=%s; Path=/; HttpOnly' % (self.toggle_key, self.enable_value)
        elif disable:
            cookie_to_set = '%s=; Path=/; Max-Age=1; HttpOnly' % self.toggle_key

        if enable:
            start = time.time()
            profile = Profile()
            profile.runcall(run_app, environ)  # here we call the WSGI app
            elapsed = time.time() - start
        else:
            profile = elapsed = None  # for annoying IDE
            run_app(environ)

        status, headers = saved_ss_args[:2]
        headers_dic = Headers(headers)
        if cookie_to_set:
            headers_dic.add_header('Set-Cookie', cookie_to_set)

        # insert result into response
        content_type = headers_dic.get('Content-Type', '')
        if (enable and status.startswith('200') and content_type.startswith('text/html')):
            environ['QUERY_STRING'] = dict2query_str(query)

            matched = _find_charset.match(content_type)
            encoding = matched.group(1) if matched else 'ascii'
            rendered = self.render_result(profile, elapsed, environ).encode(encoding, 'replace')
            resp_body = [insert_into_body(rendered, b''.join(resp_body))]
            headers_dic['Content-Length'] = str(len(resp_body[0]))
        start_response(status, headers, saved_ss_args[2] if len(saved_ss_args) == 3 else None)
        return resp_body

    def render_result(self, profile, time_elapsed, environ):
        profile.create_stats()
        stats = profile.stats
        fmt = '{:.2f}'.format

        function_calls = []
        for func, info in iteritems(stats):
            current = {}
            filename = pstats.func_std_string(func)
            # hide our hook functions
            if filename.startswith(_file_path):
                continue

            # col0: filename
            if filename.startswith(('{', '<')):  # built-in functions
                name, name_full = filename, 'n/a'
            else:  # functions from library and our project
                name, name_full = shorten_filename(filename), filename
            current['filename'], current['filename_full'] = name, name_full

            # skip functions that is in library or built-in
            if self.simple_output and name.startswith(('{', '<')):
                continue

            # col1: number of calls
            if info[0] != info[1]:
                current['ncalls'] = '%d/%d' % (info[1], info[0])
            else:
                current['ncalls'] = info[1]
            # col2: total time
            current['tottime'] = fmt(info[2] * 1000)
            # col3: quotient of total time divided by number of calls
            current['percall'] = fmt(info[2] * 1000 / info[1])  if info[1] else 0
            # col4: cumulative time
            current['cumtime'] = fmt(info[3] * 1000)
            # col5: quotient of the cumulative time divided by the number of
            # primitive calls.
            current['percall_cum'] = fmt(info[3] * 1000 / info[0]) if info[0] else 0

            function_calls.append(current)

        path = reconstruct_path(environ) + ('&' if environ.get('QUERY_STRING') else '?')

        return _template.render(
            ms_elapsed='{:.1f}'.format(time_elapsed * 1000),
            function_calls=function_calls,
            disable_url=path + '%s=' % self.toggle_key,
            toggle_simple_output_url=path + '%s=%s' % (self.SIMPLE_OUTPUT_TOGGLE_KEY,
                                                       not self.simple_output),
            simple_output=self.simple_output
        )
