import {
  ArrowRight,
  Mountain,
  Store,
  Layers3,
  ShieldCheck,
} from "lucide-react";

export default function Home() {
  return (
    <main className="portal">
      <header className="portal-header">
        <a className="portal-brand" href="/">
          <Mountain size={31} />
          <b>山海供</b>
          <span>SHANHAI SUPPLY</span>
        </a>
        <a href="/operations">
          运营登录 <ArrowRight size={15} />
        </a>
      </header>
      <section className="portal-hero">
        <div>
          <span className="eyebrow">从螺蛳湾，连接更远的生意</span>
          <h1>
            汇聚好货，
            <br />
            供向山海。
          </h1>
          <p>
            维护好你的商品、价格与供货条件。
            <br />
            让平台组织货源，连接海外采购。
          </p>
          <a className="btn primary" href="/merchant">
            进入商户供货端 <ArrowRight size={18} />
          </a>
          <small>
            <ShieldCheck size={15} /> 商户免费入驻 · 供货资格独立审核
          </small>
        </div>
        <div className="portal-art" aria-hidden="true">
          <div className="art-sun" />
          <div className="art-mountain back" />
          <div className="art-mountain front" />
          <div className="art-sea" />
          <div className="art-stamp">
            山<br />海<br />供
          </div>
          <p>好货有源 · 供货有序</p>
        </div>
      </section>
      <section className="portal-cards">
        <a href="/merchant">
          <Store size={27} />
          <h2>我是供货商户</h2>
          <p>申请入驻、关联商品，随时更新供货价、数量和交期。</p>
          <span>
            进入供货端 <ArrowRight size={16} />
          </span>
        </a>
        <a href="/operations">
          <Layers3 size={27} />
          <h2>我是平台运营</h2>
          <p>审核商户与商品，集中管理同款商品的多家供货条件。</p>
          <span>
            进入运营后台 <ArrowRight size={16} />
          </span>
        </a>
      </section>
      <footer className="portal-footer">
        <span>山海供 · 螺蛳湾海外供货平台</span>
        <span>当前开放商户供货维护</span>
      </footer>
    </main>
  );
}
