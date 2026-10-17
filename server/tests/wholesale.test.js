import test from 'node:test';
import { isolateTestUploads, removeTestDirectory } from '../../scripts/test-support.mjs';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../app.js';
import { User, Product } from '../models.js';
import { WholesaleBuyer, WholesaleProduct, WholesaleEnquiry } from '../wholesale-models.js';
import { readSourceProducts, sourceProductData, upsertWholesaleImports } from '../wholesale-import.js';
import { initialProducts } from '../../shared/catalog.js';

test('wholesale accounts, protected prices, enquiries, and admin management', {timeout:60000}, async t => {
  const uploadDirectory = await isolateTestUploads();
  const databaseName=`masaloo_test_wholesale_${randomUUID().replaceAll('-','')}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`,{serverSelectionTimeoutMS:5000});
  process.env.JWT_SECRET='wholesale-test-secret-at-least-thirty-two-characters';
  await Promise.all([User.init(),Product.init(),WholesaleBuyer.init(),WholesaleProduct.init(),WholesaleEnquiry.init()]);
  const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const cookies={}; let buyerCookie,otherCookie,ownerId,enquiryId;
  const request=async(route,{method='GET',body,cookie,role}={})=>{
    const response=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...((cookie||cookies[role])?{Cookie:cookie||cookies[role]}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
  };
  const seed=JSON.parse(await readFile(new URL('../../data/wholesale-catalog.json',import.meta.url),'utf8')).products.slice(0,2);
  const editBody={name:seed[0].name,category:seed[0].category,description:seed[0].description,image:seed[0].image,pricePerKg:250.50,minOrderKg:5,stockKg:100,active:true};
  try{
    for(const role of ['owner','manager','editor','customer','pending']){
      const user=await User.create({name:role,email:`${role}@wholesale.test`,passwordHash:'test-session-only',role});
      cookies[role]=`masaloo_session=${jwt.sign({},process.env.JWT_SECRET,{subject:user.id,expiresIn:'1h'})}`;
      if(role==='owner')ownerId=user.id;
    }
    await Product.create(initialProducts[0]);await WholesaleProduct.insertMany(seed);
    await t.test('anonymous visitors cannot read wholesale products or prices',async()=>{
      assert.equal((await request('/wholesale/products')).status,401);
      assert.equal((await request(`/wholesale/products/${seed[0].id}`)).status,401);
      assert.equal((await request('/wholesale/enquiries')).status,401);
      assert.equal((await request('/products')).data.products.length,1);
      assert.equal((await request('/products')).data.products[0].unitPricePaise,undefined);
    });
    await t.test('username/password registration creates a separate buyer and requires a subsequent login',async()=>{
      const result=await request('/wholesale/auth/register',{method:'POST',body:{username:'Bulk.Shop',password:'wholesale-password',role:'owner',active:false}});
      assert.equal(result.status,201);assert.equal(result.data.username,'bulk.shop');assert.equal(result.cookie,undefined);
      assert.equal((await request('/wholesale/auth/me')).status,401);
      const buyer=await WholesaleBuyer.findOne({username:'bulk.shop'}).select('+passwordHash');
      assert.equal(buyer.active,true);assert.equal(await bcrypt.compare('wholesale-password',buyer.passwordHash),true);
      assert.equal(buyer.role,undefined);assert.equal(result.data.passwordHash,undefined);
      assert.equal((await request('/wholesale/auth/register',{method:'POST',body:{username:'BULK.SHOP',password:'wholesale-password'}})).status,409);
      assert.equal((await request('/wholesale/auth/register',{method:'POST',body:{username:'bad user',password:'wholesale-password'}})).status,400);
    });
    await t.test('wholesale login uses its own cookie, validates credentials, and restores sessions',async()=>{
      assert.equal((await request('/wholesale/auth/login',{method:'POST',body:{username:'bulk.shop',password:'wrong-password'}})).status,401);
      const result=await request('/wholesale/auth/login',{method:'POST',body:{username:' BULK.SHOP ',password:'wholesale-password'}});
      assert.equal(result.status,200);buyerCookie=result.cookie;
      assert.match(result.headers.get('set-cookie'),/masaloo_wholesale_session=/);assert.match(result.headers.get('set-cookie'),/HttpOnly/);assert.match(result.headers.get('set-cookie'),/SameSite=Strict/);
      assert.equal((await request('/wholesale/auth/me',{cookie:buyerCookie})).data.buyer.username,'bulk.shop');
      assert.equal((await request('/auth/me',{cookie:buyerCookie})).status,401);
      assert.equal((await request('/admin/wholesale/products',{cookie:buyerCookie})).status,401);
      const forgedContext=`masaloo_session=${jwt.sign({},process.env.JWT_SECRET,{subject:ownerId,audience:'masaloo-wholesale',issuer:'masaloo-wholesale'})}`;
      assert.equal((await request('/admin/wholesale/products',{cookie:forgedContext})).status,401);
    });
    await t.test('owners and managers manage a separate wholesale price without changing retail prices',async()=>{
      for(const role of ['editor','customer','pending']) assert.equal((await request('/admin/wholesale/products',{role})).status,403);
      assert.equal((await request(`/admin/wholesale/products/${seed[0].id}`,{role:'manager',method:'PUT',body:editBody})).status,200);
      const result=await request('/wholesale/products',{cookie:buyerCookie});
      assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
      const product=result.data.products.find(p=>p.id===seed[0].id);
      assert.equal(product.unitPricePaise,25050);assert.equal(product.minOrderKg,5);assert.equal(product.source,undefined);
      assert.equal((await request('/products')).data.products[0].price,120);
      assert.equal((await request('/wholesale/products?search=%5B',{cookie:buyerCookie})).data.products.length,0);
    });
    await t.test('bulk enquiries enforce minimums and stock while computing prices on the server',async()=>{
      const body={id:randomUUID(),contactName:'Bulk Buyer',phone:'9876543210',items:[{productId:seed[0].id,quantityKg:4}]};
      assert.equal((await request('/wholesale/enquiries',{method:'POST',cookie:buyerCookie,body})).status,400);
      assert.equal((await request('/wholesale/enquiries',{method:'POST',cookie:buyerCookie,body:{...body,items:[{productId:seed[0].id,quantityKg:101}]}})).status,400);
      assert.equal((await request('/wholesale/enquiries',{method:'POST',cookie:buyerCookie,body:{...body,items:[{productId:seed[0].id,quantityKg:5.5}]}})).status,400);
      const data={id:randomUUID(),contactName:'Bulk Buyer',phone:'9876543210',business:'Test kitchen',notes:'Bulk packing please',items:[{productId:seed[0].id,quantityKg:5,unitPricePaise:1,totalPaise:5},{productId:seed[1].id,quantityKg:5}],totalPaise:1,buyerId:ownerId,internalNotes:'Not accepted from buyer'};
      const result=await request('/wholesale/enquiries',{method:'POST',cookie:buyerCookie,body:data});
      assert.equal(result.status,201);enquiryId=result.data.enquiry.id;
      assert.equal(result.data.enquiry.items[0].unitPricePaise,25050);assert.equal(result.data.enquiry.pricedSubtotalPaise,125250);assert.equal(result.data.enquiry.totalPaise,null);assert.equal(result.data.enquiry.hasUnpricedItems,true);
      assert.equal(result.data.enquiry.username,'bulk.shop');assert.equal(result.data.enquiry.internalNotes,undefined);
      assert.equal((await request('/wholesale/enquiries',{method:'POST',cookie:buyerCookie,body:data})).data.replayed,true);
      assert.equal((await request('/wholesale/enquiries',{method:'POST',cookie:buyerCookie,body:{...data,notes:'Changed requirement'}})).status,409);
      assert.equal(await WholesaleEnquiry.countDocuments(),1);
      assert.equal((await WholesaleProduct.findOne({id:seed[0].id})).stockKg,100);
    });
    await t.test('buyers see only their own enquiries and cannot read private team notes',async()=>{
      await request('/wholesale/auth/register',{method:'POST',body:{username:'second.buyer',password:'wholesale-password'}});
      otherCookie=(await request('/wholesale/auth/login',{method:'POST',body:{username:'second.buyer',password:'wholesale-password'}})).cookie;
      assert.equal((await request('/wholesale/enquiries',{cookie:otherCookie})).data.total,0);
      const result=await request(`/admin/wholesale/enquiries/${enquiryId}`,{role:'manager',method:'PATCH',body:{status:'quoted',quotedTotal:1550.25,buyerMessage:'5 kg packs. Delivery will be confirmed.',internalNotes:'Private supplier cost note'}});
      assert.equal(result.status,200);assert.equal(result.data.enquiry.quotedTotalPaise,155025);
      const history=(await request('/wholesale/enquiries',{cookie:buyerCookie})).data.enquiries[0];
      assert.equal(history.status,'quoted');assert.equal(history.quotedTotalPaise,155025);assert.equal(history.buyerMessage,'5 kg packs. Delivery will be confirmed.');assert.equal(history.internalNotes,undefined);assert.equal(history.requestFingerprint,undefined);
    });
    await t.test('current product edits do not rewrite enquiry snapshots and hidden products cannot be requested',async()=>{
      await request(`/admin/wholesale/products/${seed[0].id}`,{role:'owner',method:'PUT',body:{...editBody,pricePerKg:399,name:'Updated raw spice',active:false}});
      const history=(await request('/wholesale/enquiries',{cookie:buyerCookie})).data.enquiries[0];
      assert.equal(history.items[0].name,seed[0].name);assert.equal(history.items[0].unitPricePaise,25050);
      assert.equal((await request(`/wholesale/products/${seed[0].id}`,{cookie:buyerCookie})).status,404);
      assert.equal((await request('/wholesale/enquiries',{method:'POST',cookie:buyerCookie,body:{id:randomUUID(),contactName:'Buyer',phone:'9876543210',items:[{productId:seed[0].id,quantityKg:5}]}})).status,400);
    });
    await t.test('source refresh preserves edited prices, minimums, photos, names, and visibility',async()=>{
      await WholesaleProduct.updateOne({id:seed[0].id},{$set:{description:'My own bulk product details',minOrderKg:10,image:'/images/haldi.webp'}});
      const updated={...seed[0],source:{...seed[0].source,packs:[{label:'100g',retailPricePaise:9900,mrpPaise:9900}]}};
      const result=await upsertWholesaleImports([updated]);assert.equal(result.refreshed,1);
      const product=await WholesaleProduct.findOne({id:seed[0].id});
      assert.equal(product.name,'Updated raw spice');assert.equal(product.unitPricePaise,39900);assert.equal(product.description,'My own bulk product details');assert.equal(product.minOrderKg,10);assert.equal(product.image,'/images/haldi.webp');assert.equal(product.active,false);assert.equal(product.source.packs[0].retailPricePaise,9900);
    });
    await t.test('disabling a buyer blocks existing sessions and future logins; logout clears only wholesale cookies',async()=>{
      const buyer=await WholesaleBuyer.findOne({username:'bulk.shop'});
      assert.equal((await request(`/admin/wholesale/buyers/${buyer.id}`,{role:'manager',method:'PATCH',body:{active:false}})).status,200);
      assert.equal((await request('/wholesale/products',{cookie:buyerCookie})).status,403);
      assert.equal((await request('/wholesale/auth/login',{method:'POST',body:{username:'bulk.shop',password:'wholesale-password'}})).status,403);
      await request(`/admin/wholesale/buyers/${buyer.id}`,{role:'owner',method:'PATCH',body:{active:true}});
      const logout=await request('/wholesale/auth/logout',{method:'POST',cookie:otherCookie});
      assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/masaloo_wholesale_session=;/);assert.doesNotMatch(logout.headers.get('set-cookie'),/masaloo_session=/);
    });
  }finally{
    await removeTestDirectory(uploadDirectory);
    if(!mongoose.connection.name.startsWith('masaloo_test_wholesale_'))throw new Error('Refusing to clean up a non-test database.');
    await mongoose.connection.dropDatabase();await mongoose.disconnect();await new Promise(resolve=>server.close(resolve));
  }
});

test('public source parser imports whole-spice facts without reusing marketing descriptions or retail prices as wholesale rates',()=>{
  const source={id:123,name:'Cumin Seeds',categoryIds:[80704],images:['https://cdn.rodeodigital.com/test.jpg'],desc:'Source marketing content not to copy',skus:[{name:'100g',sp:55,mrp:60}]};
  const html=`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{productSearch:{products:[source,{...source,id:124,categoryIds:[80749]}]}}}})}</script>`;
  assert.equal(readSourceProducts(html).length,1);
  const data=sourceProductData(source,'/images/source.webp');
  assert.equal(data.unitPricePaise,null);assert.equal(data.minOrderKg,5);assert.equal(data.source.packs[0].retailPricePaise,5500);assert.notEqual(data.description,source.desc);assert.equal(data.image,'/images/source.webp');
  assert.throws(()=>readSourceProducts('<html>No embedded products</html>'));
});
