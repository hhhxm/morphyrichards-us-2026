// 获取元素是否在可视区域
function MB_isElementInViewport(el) {
  var rect = el.getBoundingClientRect();
  return (
    rect.top >= -rect.height &&
    rect.left >= -rect.width &&
    rect.bottom <=
      (window.innerHeight || document.documentElement.clientHeight) + rect.height &&
    rect.right <=
      (window.innerWidth || document.documentElement.clientWidth) + rect.width
  )
} 
function MB_getPriceData(e) {
  const target = e.find("ins .money").lenght > 0 ? e.find("ins .money") : e.find(".money")
  let string = target.text()
  if(e.attr('data-basecut4')){
    string = e.attr('data-basecut4')
  }
  const re = /^(\W+)((\d+)(\.\d+)?)/.exec(string)
  return {
    currency: re[1],
    price: Number(re[2]),
  }
}
function MB_sleep(t = 1000) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve()
    }, t)
  })
}
async function MB_loadScript(url) {
  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = url;
  document.body.appendChild(script);
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(script, firstScriptTag);
  return new Promise((resolve, reject) => {
    script.addEventListener("load", resolve);
  })
}
async function MB_jsDeferHandle(method, waitObj = []) {
  for (let i = 0; i < 1000; i++) {
    let status = true;
    for (const item of waitObj) {
      if (!window[item]) {
        status = false;
        break;
      }
    }
    if (status) break
    await MB_sleep(50)
  }
  method();
}
async function MB_waitElementReady(element, isExist=true, preTime=10, total=999) {
  for (let i = 0; i < total; i++) {
    // console.log(document.querySelectorAll(element).length,element,'mibao')
    if ((document.querySelectorAll(element).length > 0 && isExist) || (document.querySelectorAll(element).length == 0 && !isExist)) {
      break
    }
    await MB_sleep(preTime)
  }
}
function MB_randomIntiNumber(long=1000000000){
  return Math.ceil(Math.random()*long)
}
function MB_is_mobile() {
  return window.innerWidth <= 768;
}
async function MB_apiFetch(url, type='GET',data=null) {
    const params = {
      method: type,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest"
      }
    }
    data && (params['body'] = JSON.stringify(data))
    const response = await fetch(url, params)
    return response.json()
}
function MB_setCookie(cname, cvalue, exdays) {
  const d = new Date();
  d.setTime(d.getTime() + (exdays*24*60*60*1000));
  let expires = "expires="+ d.toUTCString();
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}
function MB_getCookie(cname) {
  const decodedCookie = decodeURIComponent(document.cookie);
  const reg = new RegExp(`${cname}=(.*?);`)
  const res = reg.exec(decodedCookie)
  return res ? res[1] : null
}
function MB_getQueryParams(url) {
  // 如果没有提供 URL，则使用当前页面的 URL
  url = url || window.location.href;
  // 获取 URL 中的查询字符串
  const queryString = url.includes('?') ? url.split('?')[1] : '';
  // 将查询字符串转换为键值对数组
  const paramsArray = queryString.split('&');
  // 创建一个空对象来存储参数
  const queryParams = {};
  // 遍历参数数组
  paramsArray.forEach(param => {
      // 分割键和值
      const [key, value] = param.split('=');
      // 解码参数值
      queryParams[key] = decodeURIComponent(value);
  });
  return queryParams;
}
function MB_updateUrlParameter(key, value) {
  // 创建一个URLSearchParams对象
  const urlParams = new URLSearchParams(window.location.search);
  // 设置新的参数值
  urlParams.set(key, value);
  // 使用history.replaceState来修改URL，但不改变历史记录
  history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`);
}
(function(){
  function init(){
    const slider = $(".index_behind_the_products .t4s-flicky-slider")[0]
    const flickityt4s = slider.flickityt4s
    const slide_count = flickityt4s.flkty.slides.length
    const dot_width = Math.ceil(100 / slide_count)
    // $(slider).css("--slider-section-page-dot-width",`calc( ${dot_width}% - 10px )`)
    // console.log(slide_count, dot_width)

    // if(location.pathname == '/'){
    //   // MB_jsDeferHandle(setHome3Video, ['T4SThemeSP','onYouTubeIframeAPIReady'])
    //   MB_jsDeferHandle(userRecommendedListHandle, ['jQuery'])
    //   MB_jsDeferHandle(blogTrendingRecipesHandle, ['jQuery'])
    // }
    // if(/collections\/(\S+?)(\?|$)/.test(location.pathname)){
    //   // MB_jsDeferHandle(collectionFilterHandle, ['jQuery'])
    // }
    // if(/products\/(\S+?)(\?|$)/.test(location.pathname)){
    //   MB_jsDeferHandle(faqListHandle, ['jQuery'])
    //   MB_jsDeferHandle(productFastJupm, ['jQuery'])
    // }
  }

  async function initLiveChat(){
    // console.log('start init live chat')
    await MB_waitElementReady(".widget-visible iframe:nth-child(2)", preTime=10, total=9999)
    modifyLiveChatStyle()
    // 当iframe的style的内容有变化时，删除里面的!important，使用外部css可以操作。
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === "attributes") {
          // console.log("attributes changed"); 
          modifyLiveChatStyle()
        }
      });
    });

    observer.observe(document.querySelector('.widget-visible iframe:nth-child(2)'), {
      attributes: true //configure it to listen to attribute changes
    });
    // console.log('end init live chat')
  }
  function modifyLiveChatStyle(){
    $('.widget-visible iframe').each(function(){
      let css = $(this).attr('style')
      if(css.indexOf('!important')>-1){
        css = css.replaceAll(" !important",'')
        $(this).attr('style',css)
      }
    })
  }

  document.addEventListener('DOMContentLoaded', function(){
    console.log("DOMContentLoaded")
    // init()
    initLiveChat()
  })
}())