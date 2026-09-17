// Isolated production JSX fixtures. No transaction handlers or wallet/provider imports.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
export const root=fileURLToPath(new URL('../',import.meta.url));
export const account='0x1111111111111111111111111111111111111111';
export const hash=`0x${'ab'.repeat(32)}`;
function seam(file,start,end){const s=readFileSync(path.join(root,'components',file),'utf8');const a=s.indexOf(start),b=end?s.indexOf(end,a):s.length;if(a<0||b<a)throw Error('Fixture seam changed');return s.slice(a,b);}
const imports=`import * as React from 'react';
import {usePreferences} from '@/hooks/usePreferences';
import {TransactionSafetyReview} from '@/components/TransactionSafetyReview';
import {WalletPanel} from '@/components/WalletPanel';
import {formatAssetAmount,getAssetById,SUPPORTED_ASSETS} from '@/lib/assets';
import {formatArcFeeEstimate} from '@/lib/arcFees';
const forbidden=()=>{throw Error('Wallet execution forbidden in fixture');};
const noop=()=>{};
`;
export const fixtureSource=imports+`
export function SwapFixture(options={}) {
 const {locale}=usePreferences(),vi=locale==='vi';
 const fromId=options.asset??'usdc',from=getAssetById(fromId),to=getAssetById(fromId==='usdc'?'eurc':'usdc');
 const quote={fromAssetId:from.id,toAssetId:to.id,amountIn:1234567n,amountOut:1123456n,quotedAt:Date.now()};
 const unknown=options.state==='unknown'?{hash:'${hash}',quote}:undefined;
 const failure=options.state==='failure'?{hash:'${hash}',quote}:undefined;
 const success=options.state==='success'||options.state==='success-unavailable'?{hash:'${hash}',quote,received:options.state==='success'?1111111n:undefined}:undefined;
 const maxApproval=options.state==='max'?{balance:10000000n,approvalFee:1000000000000n,account:'${account}'}:undefined;
 const reviewStage=options.state==='approval'?'approval':['review','preflight','awaiting','pending','unavailable','expired'].includes(options.state)?'swap':undefined;
 const swapLocked=['preflight','awaiting','pending'].includes(options.state);
 const submissionStatus=options.state==='pending'?'submitted-pending':'idle',executionInFlightRef={current:swapLocked};
 const route={provider:'xylonet'},slippage=.005,swapGasFee=options.state==='unavailable'?undefined:1000000000000n,approvalGasFee=1000000000000n;
 const gasUnavailable=options.state==='unavailable',gasCost={sufficientGasBalance:!gasUnavailable};
 const balance=10000000n,connection={address:'${account}',isConnected:true},chain={isArc:true},reviewedAccount=connection.address;
 const approvalGasCovered=true,maxApprovalGasCovered=true;
 const pending=options.state==='preflight'?(vi?'Đang kiểm tra cuối cùng…':'Running final preflight…'):options.state==='awaiting'?(vi?'Chờ xác nhận trong ví…':'Waiting for wallet confirmation…'):options.state==='pending'?(vi?'Đang chờ xác nhận trên Arc…':'Waiting for Arc confirmation…'):undefined;
 const error=options.error;
 const [amount,setAmount]=React.useState('1.234567'),mode='smart',safeMax=undefined,quickFeedback=undefined;
 const reset=noop,setReviewStage=noop,setQuote=noop,setMaxApproval=noop,setFromId=noop,setMode=noop,setSlippage=noop,invalidate=noop;
 const review=noop,execute=forbidden,approveThenReview=forbidden,approveForMax=forbidden,chooseQuickAmount=noop,changeAmount=setAmount;
 const swapIsInFlight=()=>swapLocked,swapBackAllowed=()=>!swapLocked;
 const globalReviewChecks=()=>[],isSwapQuoteFresh=()=>options.state!=='expired';
 const minimumSwapOutput=()=>1117838n,swapRouteLabel=()=> 'XyloNet StableSwap';
 const SWAP_SLIPPAGE_OPTIONS=[.001,.005,.01],XYLO_ROUTER='0x2222222222222222222222222222222222222222';
 const CIRCLE_BROWSER_SWAP_STATUS={reason:vi?'Không khả dụng trong trình duyệt':'Unavailable in the browser'},ARC_EXPLORER_URL='https://testnet.arcscan.app';
${seam('RealSwapFlow.tsx','  if (unknown) {','\nfunction reviewNow()')}
export function BridgeFixture(options={}) {
 const {locale}=usePreferences(),vi=locale==='vi';
 const source={id:84532,name:'Base Sepolia',usdc:'0x2222222222222222222222222222222222222222',nativeGas:'ETH'},destination={id:5042002,name:'Arc Testnet'};
 const [amount,setAmount]=React.useState('1.234567'),[custom,setCustom]=React.useState(false),[recipient,setRecipient]=React.useState('');
 const speed='STANDARD',balance=10000000n,sourceId=source.id,connection={address:'${account}',isConnected:true};
 const estimate=options.state==='form'?undefined:{source,destination,amount:'1.234567',recipient:'${account}',speed,expectedReceive:options.state==='unavailable'?undefined:'1.23',fees:[{label:vi?'Phí mạng nguồn':'Source network fee',amount:'0.000000123456789',token:'ETH',type:'gas'},{label:vi?'Phí chuyển tiếp':'Forwarding fee',amount:options.state==='unavailable'?undefined:'0.004567',token:'USDC',type:'forwarding'}],raw:{source:{address:'${account}'}}};
 const reviewSnapshot=estimate?{expiresAt:2000000000000,assessment:{status:'review',checks:[{code:'request-simulation-not-performed',status:'warning',message:'Circle App Kit'}]},intent:{kind:'bridge',assetId:'usdc',amount:1234567n}}:undefined;
 const result=options.state==='success'?{amount:'1.234567',sourceChain:source,destinationChain:destination,recipient:'${account}',sourceExplorerUrl:'https://sepolia.basescan.org/tx/${hash}',destinationExplorerUrl:options.noDestinationLink?undefined:'https://testnet.arcscan.app/tx/${hash}'}:undefined;
 const busy=options.state==='executing'?'executing':'idle',stages=options.state==='executing'?['preparing','approval','burn']:options.state==='failure'?['preparing','failed']:[];
 const error=options.state==='failure'?(vi?'Yêu cầu Bridge thất bại.':'Bridge request failed.'):options.error,advanced=false;
 const invalidate=noop,execute=forbidden,review=noop,reverse=noop,setSourceId=noop,setSpeed=noop,setAdvanced=noop,onBusyChange=noop;
 const bridgeReviewIsActionable=(r,e,s)=>!r&&e&&s,formatUnits=()=> '10',QA_BRIDGE_CHAINS=[source,destination],supportsFastSource=()=>true;
 const CctpBridgeFlow=()=>null;
${seam('UniversalBridgeFlow.tsx','  const timeline:')}
export function ExchangeFixture({kind='swap',options={},onClose=noop}) {
 const locked=kind==='swap'?['preflight','awaiting','pending'].includes(options.state):options.state==='executing';
 return <WalletPanel title={kind==='swap'?'Swap':'Bridge'} onClose={onClose} closeDisabled={locked}><div className="ledger-exchange">{kind==='swap'?<SwapFixture {...options}/>:<BridgeFixture {...options}/>}</div></WalletPanel>;
}
`;
const {translate}=require(path.join(root,'i18n/index.ts'));
let locale='en';const cache=new Map();
function compile(source,filename){
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',code)(id=>{
  if(id==='@/hooks/usePreferences')return {usePreferences:()=>({locale,t:key=>translate(locale,key)})};
  if(id.endsWith('.css'))return {};
  if(id.startsWith('@/')||id.startsWith('.')){let target=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(filename),id);if(!path.extname(target))target+=target.includes(`${path.sep}components${path.sep}`)?'.tsx':'.ts';if(!cache.has(target))cache.set(target,compile(readFileSync(target,'utf8'),target));return cache.get(target);}
  return require(id);
 },mod,mod.exports);return mod.exports;
}
const {ExchangeFixture}=compile(fixtureSource,path.join(root,'scripts/ExchangeFixture.tsx'));
export function renderExchange(kind,options={}){locale=options.locale??'en';return renderToStaticMarkup(React.createElement(ExchangeFixture,{kind,options}));}
export function fixtureCss(){return readFileSync(path.join(root,'app/globals.css'),'utf8').replace(/@import\s+["']([^"']+)["'];/g,(_,f)=>readFileSync(path.join(root,'app',f),'utf8'))+'\n'+readFileSync(path.join(root,'components/UniversalBridgeFlow.module.css'),'utf8').replace(/:global\(([^)]+)\)/g,'$1')+'\n'+readFileSync(path.join(root,'components/SwapBridge.css'),'utf8');}
if(process.argv.includes('--render')){const out={};for(const language of ['en','vi'])for(const kind of ['swap','bridge'])for(const state of kind==='swap'?['form','review','approval','max','preflight','awaiting','pending','unknown','failure','success','success-unavailable','unavailable','expired']:['form','review','executing','failure','success','unavailable'])out[`${language}-${kind}-${state}`]=renderExchange(kind,{state,locale:language});console.log(JSON.stringify(out));}
