const paperfilter = require('bindings')('paperfilter');
const EventEmitter = require('events');
const rollup = require('rollup').rollup;
const nodeResolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');
const esprima = require('esprima');
const msgpack = require('msgpack-lite');

class Session extends EventEmitter {
  constructor(option) {
    super();

    let module = {};
    (new Function('module', option.filterScript))(module);
    this._filter = module.exports;

    this._sess = new paperfilter.Session(option);
    this._sess.logCallback = (log) => {
      this.emit('log', {
        level: log.level,
        message: log.message,
        data: log
      });
    };
    this._sess.statusCallback = (stat) => {
      this.emit('status', stat);
    };
  }

  static create(option) {
    let sessOption = {
      namespace: option.namespace,
      dissectors: [],
      stream_dissectors: []
    };

    let tasks = [];
    if (Array.isArray(option.dissectors)) {
      for (let diss of option.dissectors) {
        tasks.push(rollup({
          entry: diss.script,
          external: ['dripcap'],
          plugins: [
            nodeResolve({ jsnext: true, main: true }),
            commonjs()
          ],
          onwarn: (e) => {
            console.log(e)
          }
        }).then((bundle) => {
          const result = bundle.generate({
            format: 'cjs'
          });
          return result.code;
        }).then((code) => {
          sessOption.dissectors.push({
            script: code,
            resourceName: diss.script
          });
        }));
      }
    }
    if (Array.isArray(option.stream_dissectors)) {
      for (let diss of option.stream_dissectors) {
        tasks.push(rollup({
          entry: diss.script,
          external: ['dripcap'],
          plugins: [
            nodeResolve({ jsnext: true, main: true }),
            commonjs()
          ],
          onwarn: (e) => {
            console.log(e)
          }
        }).then((bundle) => {
          const result = bundle.generate({
            format: 'cjs'
          });
          return result.code;
        }).then((code) => {
          sessOption.stream_dissectors.push({
            script: code,
            resourceName: diss.script
          });
        }));
      }
    }
    tasks.push(rollup({
      entry: __dirname + '/filter.es',
      plugins: [
        nodeResolve({ jsnext: true, main: true }),
        commonjs()
      ],
      onwarn: (e) => {
        console.log(e)
      }
    }).then((bundle) => {
      const result = bundle.generate({
        format: 'cjs'
      });
      return result.code;
    }).then((code) => {
      sessOption.filterScript = code;
    }));
    return Promise.all(tasks).then(() => {
      return new Session(sessOption);
    });
  }

  analyze(pkt) {
    return this._sess.analyze(pkt);
  }

  filter(name, filter) {
    let body = '';
    const ast = esprima.parse(filter);
    switch (ast.body.length) {
      case 0:
        break;
      case 1:
        const root = ast.body[0];
        if (root.type !== "ExpressionStatement")
          throw new SyntaxError();
        this._filter(root.expression);
        body = JSON.stringify(root.expression);
        break;
      default:
        throw new SyntaxError();
    }
    return this._sess.filter(name, body);
  }

  get(seq) {
    return this._sess.get(seq);
  }

  getFiltered(name, start, end) {
    return this._sess.getFiltered(name, start, end);
  }

  get namespace() {
    return this._sess.namespace;
  }

  get permission() {
    return this._sess.permission;
  }

  static get permission() {
    if (process.env['DRIPCAP_UI_TEST'] != null) {
      return true;
    }
    return paperfilter.Session.permission;
  }

  static get devices() {
    if (process.env['DRIPCAP_UI_TEST'] != null) {
      return require(process.env['DRIPCAP_UI_TEST'] + '/list.json');
    }
    return paperfilter.Session.devices;
  }

  static get tmpDir() {
    return paperfilter.Session.tmpDir;
  }

  get interface() {
    return this._sess.interface;
  }

  set interface(ifs) {
    this._sess.interface = ifs;
  }

  get promiscuous() {
    return this._sess.promiscuous;
  }

  set promiscuous(promisc) {
    this._sess.promiscuous = promisc;
  }

  get snaplen() {
    return this._sess.snaplen;
  }

  set snaplen(len) {
    this._sess.snaplen = len;
  }

  setBPF(bpf) {
    this._sess.setBPF(bpf);
  }

  start() {
    if (process.env['DRIPCAP_UI_TEST'] != null) {
      let readStream = require('fs').createReadStream(process.env['DRIPCAP_UI_TEST'] + '/dump.msgpack');
      let decodeStream = msgpack.createDecodeStream();

      readStream.pipe(decodeStream).on("data", (data) => {
        if (data.length === 4) {
          let pkt = {
            ts_sec: data[0],
            ts_nsec: data[1],
            length: data[2],
            payload: data[3]
          };
          this._sess.analyze(pkt);
        }
      });
    } else {
      this._sess.start();
    }
  }

  stop() {
    this._sess.stop();
  }

  close() {
    this._sess.close();
  }
}

module.exports = {
  Session: Session
}