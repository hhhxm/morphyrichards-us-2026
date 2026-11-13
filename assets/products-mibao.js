(function(){
  async function initTopBanner(){
    await MB_waitElementReady(".top_banner a.t4s-bl-item")
    $(".top_banner a.t4s-bl-item").click(function(e){
      e.preventDefault(); 
      const toH = $(".top_banner").offset().top + $(".top_banner").height()
      $("html, body").animate({scrollTop: toH}, 800)
      console.log("clicked")
    })
  }
  document.addEventListener('DOMContentLoaded', function(){
    console.log("DOMContentLoaded")
    initTopBanner()
  })
}())