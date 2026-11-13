(function(){
  function initTimeline(){
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: ".timeline",
        start: "top top",
        end: "bottom bottom",
        scrub: true
      }
    });

    tl.to(".timeline .t4s-space-html:nth-of-type(1)+p, .timeline .t4s-space-html:nth-of-type(1)+p+h3+p", {autoAlpha:0, height:0, display:'none',duration: 1},"+=0")
    tl.to(".timeline .t4s-space-html:nth-of-type(1)+p+h3", {autoAlpha:0.5, duration: 1},'-=1')
    tl.set(".timeline .t4s-space-html:nth-of-type(2)+p, .timeline .t4s-space-html:nth-of-type(2)+p+h3+p", {display:"block", height:"auto", duration:0})
    tl.from(".timeline .t4s-space-html:nth-of-type(2)+p, .timeline .t4s-space-html:nth-of-type(2)+p+h3+p", {height :0,duration: 1})
    tl.to(".timeline .t4s-space-html:nth-of-type(2)+p+h3", {autoAlpha:1, duration: 1},'-=1')
    tl.to(".timeline .t4s-space-html:nth-of-type(2)+p, .timeline .t4s-space-html:nth-of-type(2)+p+h3+p", {autoAlpha:0, height:0, display:'none'},"+=0")
    tl.to(".timeline .t4s-space-html:nth-of-type(2)+p+h3", {autoAlpha:0.5, duration: 1},'-=1')
    tl.set(".timeline .t4s-space-html:nth-of-type(3)+p, .timeline .t4s-space-html:nth-of-type(3)+p+h3+p", {display:"block", height:"auto", duration:0})
    tl.from(".timeline .t4s-space-html:nth-of-type(3)+p, .timeline .t4s-space-html:nth-of-type(3)+p+h3+p", {height :0,duration: 1})
    tl.to(".timeline .t4s-space-html:nth-of-type(3)+p+h3", {autoAlpha:1, duration: 1},'-=1')
    const timer_count = tl._tDur
    tl.to(".timeline .t4s-custom-col", {"--red-point-y": "90%",duration: timer_count},`-=${timer_count}`)
    // console.log(tl, timer_count)
  }
  async function initHistoryYears(){
    await MB_waitElementReady(".milestones_in_the_history_columns .t4s-flicky-slider [data-select-flickity]")
    
    const el = $(".milestones_in_the_history_colunns .t4s-flicky-slider")[0]
    const carousel = el.flickityt4s.$carousel
    const flkty = el.flickityt4s.flkty
    carousel.on("select.flickityt4s", function (t, index) {
      $(".milestones_in_the_history_years .t4s-col-item").removeClass("is_select")
      $(`.milestones_in_the_history_years .t4s-col-item:nth-child(${index+1})`).addClass("is_select")

      const el = $(".milestones_in_the_history_years .t4s-flicky-slider")[0]
      const carousel = el.flickityt4s.$carousel
      carousel.flickityt4s('selectCell', index)
    });
    // el.flickityt4s.flkty.resize()
    // carousel.flickityt4s("setCellAlign",'center')
    // carousel.flickityt4s("updateSlides")
    // console.log(123123)
    
    $(".milestones_in_the_history_years .t4s-col-item:nth-child(1)").addClass("is_select")
    $(".milestones_in_the_history_years .t4s-col-item h3").each(function(i,e){
      const year = $(this).text()
      const el = `.milestones_in_the_history_colunns .t4s-col-item:nth-child(${i+1})`
      $(el).css({"--year": `"${year}"`})      
    })
    $(".milestones_in_the_history_years .t4s-col-item").click(function(i,e){
      const index = $(this).index() 
      $(".milestones_in_the_history_years .t4s-col-item").removeClass('is_select')
      $(this).addClass('is_select')

      const el = $(".milestones_in_the_history_colunns .t4s-flicky-slider")[0]
      const carousel = el.flickityt4s.$carousel
      carousel.flickityt4s('selectCell', index)
    })



  }
  document.addEventListener('DOMContentLoaded', function(){
    console.log("DOMContentLoaded")
    MB_jsDeferHandle(initTimeline, ['jQuery'])
    MB_jsDeferHandle(initHistoryYears, ['jQuery'])
  })
}())