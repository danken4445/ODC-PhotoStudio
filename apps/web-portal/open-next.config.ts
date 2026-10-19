// OpenNext Cloudflare configuration for @opennextjs/cloudflare
// See: https://opennext.js.org/cloudflare

export default {
  default: {
    override: {
      wrapper: 'cloudflare-node',
      converter: 'edge',
      incrementalCache: 'dummy',
      tagCache: 'dummy',
      queue: 'dummy'
    }
  }
};
